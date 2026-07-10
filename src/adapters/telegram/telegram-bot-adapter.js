import { TelegramAIBot } from '../../services/telegram-bot.js';

export function createTelegramBot({ config, db, aiClient, providerManager, toolRegistry, pluginManager, logger, accessControl }) {
  return new TelegramAIBot({ config, db, aiClient, providerManager, toolRegistry, pluginManager, logger, accessControl });
}
