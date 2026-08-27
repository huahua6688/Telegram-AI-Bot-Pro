import { PlatformModesTelegramAIBot } from '../../services/platform-modes-telegram-bot.js';

export function createTelegramBot({
  config,
  db,
  aiClient,
  providerManager,
  toolRegistry,
  pluginManager,
  logger,
  accessControl,
  githubService,
  agentTaskService
}) {
  return new PlatformModesTelegramAIBot({
    config,
    db,
    aiClient,
    providerManager,
    toolRegistry,
    pluginManager,
    logger,
    accessControl,
    githubService,
    agentTaskService
  });
}
