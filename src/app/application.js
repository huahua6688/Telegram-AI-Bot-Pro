import fs from 'node:fs';
import path from 'node:path';
import { createConfigCenter } from '../core/config/config-center.js';
import { AppError } from '../core/errors/app-error.js';
import { ErrorCodes } from '../core/errors/error-codes.js';
import { loadEnvConfig } from '../adapters/config/env-config-adapter.js';
import { createDatabase } from '../adapters/persistence/database-adapter.js';
import { createAIProviderClient } from '../adapters/ai/ai-client-adapter.js';
import { createAIProviderManager } from '../services/ai-provider-manager.js';
import { createToolRegistry } from '../adapters/tools/tool-registry-adapter.js';
import { createPluginManager } from '../adapters/plugins/plugin-manager-adapter.js';
import { createTelegramBot } from '../adapters/telegram/telegram-bot-adapter.js';
import { startHealthServer } from '../services/health-server.js';
import { installEnhancedStatusRoutes } from '../services/status-routes.js';
import { startAdminApiServer } from '../services/admin-api-server.js';
import { assertRuntimeConfig } from './runtime-config-validation.js';
import { AccessControlService } from '../services/access-control-service.js';
import { createStructuredLogger } from '../core/observability/structured-logger.js';
import {
  StartupDiagnosticsError,
  collectStartupDiagnostics,
  logStartupDiagnostics
} from './startup-diagnostics.js';
import {
  createApplicationLifecycle,
  stopApplicationResources
} from './application-lifecycle.js';
import { createSupportBot } from '../services/support-bot.js';

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
  let db;
  let bot;
  let supportBot;
  let healthServer;
  let adminServer;
  let privacySweepTimer;
  const readiness = { ready: false, phase: 'initializing' };

  try {
    const rawConfig = loadEnvConfig();
    const configCenter = createConfigCenter(rawConfig);
    const runtimeConfig = configCenter.raw;

    assertRuntimeConfig(runtimeConfig);

    ensureRuntimeFileDirectory(runtimeConfig.databaseFile, 'DATABASE_FILE');
    ensureRuntimeFileDirectory(runtimeConfig.legacyDataFile, 'DATA_FILE');

    let startupDiagnostics = null;
    if (runtimeConfig.enableStartupDiagnostics !== false) {
      startupDiagnostics = collectStartupDiagnostics({
        config: runtimeConfig,
        env: process.env,
        cwd: process.cwd()
      });
      logStartupDiagnostics(startupDiagnostics, { logger });
      if (!startupDiagnostics.ok) throw new StartupDiagnosticsError(startupDiagnostics);
    }

    db = await createDatabase(runtimeConfig);
    const sweepPrivateConversationData = async () => {
      if (runtimeConfig.conversationRetentionDays <= 0) return;
      const purged = await db.purgeExpiredConversationSessions(runtimeConfig.conversationRetentionDays);
      if (purged.sessions || purged.legacyConversations) {
        logger.info('Expired conversation data removed', purged);
      }
    };
    await sweepPrivateConversationData();
    privacySweepTimer = setInterval(
      () => sweepPrivateConversationData().catch((error) => {
        logger.warn('Conversation privacy sweep failed', { error: error.message });
      }),
      runtimeConfig.privacySweepIntervalHours * 60 * 60 * 1000
    );
    privacySweepTimer.unref?.();
    const accessControl = new AccessControlService({ config: runtimeConfig, db, logger });
    const aiClient = createAIProviderClient(runtimeConfig, logger);
    const providerManager = createAIProviderManager(runtimeConfig, logger, db);
    healthServer = startHealthServer({
      port: runtimeConfig.healthPort,
      db,
      config: runtimeConfig,
      logger,
      providerManager,
      readiness
    });
    if (runtimeConfig.modelDiscoveryEnabled !== false && providerManager.isConfigured('openai-compatible')) {
      try {
        await providerManager.refreshModels('openai-compatible');
      } catch (error) {
        logger.warn('AI model discovery failed; configured model fallback remains active', { providerId: 'openai-compatible', error: error.message });
      }
    }
    const toolRegistry = createToolRegistry(runtimeConfig, logger, accessControl);
    const pluginManager = await createPluginManager(runtimeConfig, logger);
    supportBot = createSupportBot({ config: runtimeConfig, logger });
    if (supportBot) {
      await supportBot.init();
      if (!String(runtimeConfig.supportBotUsername || '').trim() && supportBot.botInfo?.username) {
        runtimeConfig.supportBotUsername = supportBot.botInfo.username;
      }
    }

    bot = createTelegramBot({
      config: runtimeConfig,
      db,
      aiClient,
      providerManager,
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
      providerFallbackOrder: runtimeConfig.aiProviderFallbackOrder,
      healthPort: runtimeConfig.healthPort,
      databaseFile: runtimeConfig.databaseFile,
      aiRouterMode: runtimeConfig.enableAiRouter ? runtimeConfig.aiRouterMode : 'off',
      memorySummaryInterval: runtimeConfig.memorySummaryInterval
    });

    installEnhancedStatusRoutes({
      server: healthServer,
      db,
      config: runtimeConfig,
      bot,
      supportBot,
      providerManager,
      logger,
      readiness
    });

    adminServer = startAdminApiServer({
      port: runtimeConfig.adminApiPort,
      db,
      config: runtimeConfig,
      logger,
      accessControl
    });

    const lifecycle = createApplicationLifecycle({
      bot,
      supportBot,
      healthServer,
      adminServer,
      db,
      logger,
      timers: [privacySweepTimer],
      onPrimaryReady() {
        readiness.ready = true;
        readiness.phase = 'ready';
      }
    });

    return {
      configCenter,
      logger,
      bot,
      supportBot,
      startupDiagnostics,
      healthServer,
      adminServer,
      async start() {
        readiness.phase = 'launching';
        await lifecycle.start();
        readiness.ready = true;
        readiness.phase = 'ready';
        logger.info('Telegram bot launched', {
          provider: runtimeConfig.aiProvider,
          defaultModel: runtimeConfig.defaultModel,
          healthPort: runtimeConfig.healthPort,
          supportBot: Boolean(supportBot),
          diagnostics: startupDiagnostics?.status || 'disabled'
        });
      },
      async stop(signal) {
        readiness.ready = false;
        readiness.phase = 'stopping';
        await lifecycle.stop(signal);
      }
    };
  } catch (error) {
    try {
      await stopApplicationResources(
        { bot, supportBot, healthServer, adminServer, db, logger, timers: [privacySweepTimer] },
        'INITIALIZATION_FAILED'
      );
    } catch (cleanupError) {
      logger.error('Initialization cleanup failed', {
        error: cleanupError?.message || String(cleanupError)
      });
    }
    throw AppError.wrap(error, {
      code: ErrorCodes.STARTUP_FAILED,
      message: 'Failed to bootstrap application.'
    });
  }
}
