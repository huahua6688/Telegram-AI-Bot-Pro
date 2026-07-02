import { createAIClient } from '../../services/ai-client-factory.js';

export function createAIProviderClient(config, logger) {
  return createAIClient(config, logger);
}
