import {
  ensureBuiltInAIProvidersRegistered,
  getAIProviderDefinition,
  listAIProviderDefinitions
} from './ai-provider-registry.js';

export function createAIClient(config, logger) {
  ensureBuiltInAIProvidersRegistered();
  const definition = getAIProviderDefinition(config.aiProvider);
  if (!definition) {
    const supportedProviders = listAIProviderDefinitions()
      .map((item) => item.id)
      .sort()
      .join(', ');
    throw new Error(`Unsupported AI_PROVIDER: ${config.aiProvider}. Supported: ${supportedProviders}`);
  }

  if (definition.validateConfig) {
    definition.validateConfig(config);
  }

  const client = definition.createClient(config, logger);
  if (typeof client.getProviderName !== 'function') {
    client.getProviderName = () => definition.id;
  }
  if (typeof client.getCapabilities !== 'function') {
    client.getCapabilities = () => definition.capabilities || {};
  }
  return client;
}
