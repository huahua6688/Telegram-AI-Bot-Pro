import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { BotDatabase } from './db.js';
import { createAIClient } from './services/ai-client-factory.js';
import { ToolRegistry } from './services/tool-registry.js';
import { TelegramAIBot } from './services/telegram-bot.js';
import { startHealthServer } from './services/health-server.js';

async function main() {
  const config = loadConfig();

  if (!config.botToken) {
    throw new Error('Missing BOT_TOKEN in environment.');
  }

  const db = new BotDatabase(config.dataFile);
  await db.init();

  const aiClient = createAIClient(config, logger);
  const toolRegistry = new ToolRegistry(config, logger);
  const bot = new TelegramAIBot({ config, db, aiClient, toolRegistry, logger });
  await bot.init();

  const healthServer = startHealthServer({ port: config.healthPort, db, config, logger });
  await bot.launch();

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}`);
    healthServer.close();
    await bot.stop(signal);
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('Fatal startup error', error);
  process.exit(1);
});
