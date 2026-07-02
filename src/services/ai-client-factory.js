import { ensureBuiltInAIProvidersRegistered, getAIProviderLoader } from './ai-provider-registry.js';

export function createAIClient(config, logger) {
  ensureBuiltInAIProvidersRegistered();
  return getAIProviderLoader().createClient(config, logger);
}
