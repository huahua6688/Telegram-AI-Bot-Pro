import { PlatformModesTelegramAIBot } from '../../services/platform-modes-telegram-bot.js';

export function createTelegramBot({
  config,
  db,
  aiClient,
  providerManager,
  toolRegistry,
  pluginManager,
  logger,
  accessControl
}) {
  return new PlatformModesTelegramAIBot({
    config,
    db,
    aiClient,
    providerManager,
    toolRegistry,
    pluginManager,
    logger,
    accessControl
  });
}
