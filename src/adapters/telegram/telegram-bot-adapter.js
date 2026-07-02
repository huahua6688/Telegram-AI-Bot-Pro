import { TelegramAIBot } from '../../services/telegram-bot.js';

export function createTelegramBot({ config, db, aiClient, toolRegistry, pluginManager, logger, accessControl }) {
  return new TelegramAIBot({ config, db, aiClient, toolRegistry, pluginManager, logger, accessControl });
}
