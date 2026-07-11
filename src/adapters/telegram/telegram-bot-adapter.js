import { PrivacyTelegramAIBot } from '../../services/privacy-telegram-bot.js';

export function createTelegramBot({ config, db, aiClient, providerManager, toolRegistry, pluginManager, logger, accessControl }) {
  return new PrivacyTelegramAIBot({ config, db, aiClient, providerManager, toolRegistry, pluginManager, logger, accessControl });
}
