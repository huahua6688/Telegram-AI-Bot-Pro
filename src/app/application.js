import fs from 'node:fs';
import path from 'node:path';
import { createConfigCenter } from '../core/config/config-center.js';
import { AppError } from '../core/errors/app-error.js';
import { ErrorCodes } from '../core/errors/error-codes.js';
import { loadEnvConfig } from '../adapters/config/env-config-adapter.js';
import { createDatabase } from '../adapters/persistence/database-adapter.js';
import { createAIProviderClient } from '../adapters/ai/ai-client-adapter.js';
import { createToolRegistry } from '../adapters/tools/tool-registry-adapter.js';
import { createPluginManager } from '../adapters/plugins/plugin-manager-adapter.js';
import { createTelegramBot } from '../adapters/telegram/telegram-bot-adapter.js';
import { startHealthServer } from '../services/health-server.js';
import { startAdminApiServer } from '../services/admin-api-server.js';
import { assertRuntimeConfig } from './runtime-config-validation.js';
import { AccessControlService } from '../services/access-control-service.js';
import { createStructuredLogger } from '../core/observability/structured-logger.js';

function ensureRuntimeFileDirectory(filePath = '', label = 'file') {
  const raw = String(filePath || '').trim();
  if (!raw) return;

  const dir = path.dirname(raw);
  if (!dir || dir === '.') return;

  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
}

export async function createApplication() {
  const logger = createStructuredLogger();

  try {
    const rawConfig = loadEnvConfig();
    const configCenter = createConfigCenter(rawConfig);
    const runtimeConfig = configCenter.raw;

    assertRuntimeConfig(runtimeConfig);

    ensureRuntimeFileDirectory(runtimeConfig.databaseFile, 'DATABASE_FILE');
    ensureRuntimeFileDirectory(runtimeConfig.legacyDataFile, 'DATA_FILE');

    const db = await createDatabase(runtimeConfig);
    const accessControl = new AccessControlService({ config: runtimeConfig, db, logger });
    const aiClient = createAIProviderClient(runtimeConfig, logger);
    const toolRegistry = createToolRegistry(runtimeConfig, logger, accessControl);
    const pluginManager = await createPluginManager(runtimeConfig, logger);

    const bot = createTelegramBot({
      config: runtimeConfig,
      db,
      aiClient,
      toolRegistry,
      pluginManager,
      logger,
      accessControl
    });

    await bot.init();

    logger.info('Application initialized', {
      provider: runtimeConfig.aiProvider,
      defaultModel: runtimeConfig.defaultModel,
      translationModel: runtimeConfig.translationModel,
      routerModel: runtimeConfig.routerModel,
      availableModels: runtimeConfig.availableModels,
      healthPort: runtimeConfig.healthPort,
      databaseFile: runtimeConfig.databaseFile,
      aiRouterMode: runtimeConfig.enableAiRouter ? runtimeConfig.aiRouterMode : 'off',
      memorySummaryInterval: runtimeConfig.memorySummaryInterval
    });

    const healthServer = startHealthServer({
      port: runtimeConfig.healthPort,
      db,
      config: runtimeConfig,
      logger
    });
    const adminServer = startAdminApiServer({
      port: runtimeConfig.adminApiPort,
      db,
      config: runtimeConfig,
      logger,
      accessControl
    });

    return {
      configCenter,
      logger,
      bot,
      healthServer,
      adminServer,
      async start() {
        await bot.launch();
        logger.info('Telegram bot launched', {
          provider: runtimeConfig.aiProvider,
          defaultModel: runtimeConfig.defaultModel,
          healthPort: runtimeConfig.healthPort
        });
      },
      async stop(signal) {
        healthServer.close();
        adminServer?.close();
        await bot.stop(signal);
      }
    };
  } catch (error) {
    throw AppError.wrap(error, {
      code: ErrorCodes.STARTUP_FAILED,
      message: 'Failed to bootstrap application.'
    });
  }
}
