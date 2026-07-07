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

function validateRuntimeConfig(config) {
  const errors = [];

  const botToken = String(config.botToken || '').trim();
  if (!botToken || botToken === 'your_telegram_bot_token') {
    errors.push('BOT_TOKEN is missing or still uses the placeholder value.');
  }

  const provider = String(config.aiProvider || '').toLowerCase();
  const providerChecks = {
    'openai-compatible': [config.aiApiKey, 'AI_API_KEY'],
    anthropic: [config.anthropicApiKey, 'ANTHROPIC_API_KEY or AI_API_KEY'],
    gemini: [config.geminiApiKey, 'GEMINI_API_KEY or AI_API_KEY'],
    'gemini-live': [config.geminiLiveApiKey, 'GEMINI_LIVE_API_KEY, GEMINI_API_KEY, or AI_API_KEY'],
    qwen: [config.qwenApiKey, 'QWEN_API_KEY or AI_API_KEY'],
    grok: [config.grokApiKey, 'GROK_API_KEY or AI_API_KEY'],
    deepseek: [config.deepseekApiKey, 'DEEPSEEK_API_KEY or AI_API_KEY'],
    glm: [config.glmApiKey, 'GLM_API_KEY or AI_API_KEY'],
    doubao: [config.doubaoApiKey, 'DOUBAO_API_KEY or AI_API_KEY']
  };

  const providerCheck = providerChecks[provider];
  if (providerCheck && !String(providerCheck[0] || '').trim()) {
    errors.push(`${provider} requires ${providerCheck[1]}.`);
  }

  if (!String(config.defaultModel || '').trim()) {
    errors.push('AI_MODEL is missing.');
  }

  if (config.adminApiEnabled && !String(config.adminApiToken || '').trim()) {
    errors.push('ADMIN_API_ENABLED=true requires ADMIN_API_TOKEN.');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
  }
}

export async function createApplication() {
  const logger = createStructuredLogger();

  try {
    const rawConfig = loadEnvConfig();
    const configCenter = createConfigCenter(rawConfig);
    const runtimeConfig = configCenter.raw;

    validateRuntimeConfig(runtimeConfig);

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
