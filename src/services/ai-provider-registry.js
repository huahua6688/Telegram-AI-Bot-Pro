import { createProviderLoader } from '../core/providers/provider-loader.js';
import { builtInProviderPlugins } from '../adapters/ai/providers/built-in-provider-plugins.js';

const providerLoader = createProviderLoader();

export function registerAIProvider(definition) {
  return providerLoader.register(definition);
}

export function getAIProviderDefinition(providerId) {
  return providerLoader.get(providerId);
}

export function listAIProviderDefinitions() {
  return providerLoader.list();
}

let initialized = false;
export function ensureBuiltInAIProvidersRegistered() {
  if (initialized) return;
  initialized = true;
  providerLoader.loadPlugins(builtInProviderPlugins);
}

export function getAIProviderLoader() {
  return providerLoader;
}
