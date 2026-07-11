import { HelpTelegramAIBot } from '../../services/help-telegram-bot.js';

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
  return new HelpTelegramAIBot({
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
