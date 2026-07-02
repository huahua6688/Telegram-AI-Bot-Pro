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
import { createStructuredLogger } from '../core/observability/structured-logger.js';

export async function createApplication() {
  const logger = createStructuredLogger();

  try {
    const rawConfig = loadEnvConfig();
    const configCenter = createConfigCenter(rawConfig);
    const runtimeConfig = configCenter.raw;

    const db = await createDatabase(runtimeConfig);
    const aiClient = createAIProviderClient(runtimeConfig, logger);
    const toolRegistry = createToolRegistry(runtimeConfig, logger);
    const pluginManager = await createPluginManager(runtimeConfig, logger);

    const bot = createTelegramBot({
      config: runtimeConfig,
      db,
      aiClient,
      toolRegistry,
      pluginManager,
      logger
    });

    await bot.init();

    const healthServer = startHealthServer({
      port: runtimeConfig.healthPort,
      db,
      config: runtimeConfig,
      logger
    });

    return {
      configCenter,
      logger,
      bot,
      healthServer,
      async start() {
        await bot.launch();
      },
      async stop(signal) {
        healthServer.close();
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
