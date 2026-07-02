import { createProviderContract } from './provider-contract.js';
import { defineCapabilityMatrix } from './capability-matrix.js';

export class ProviderLoader {
  constructor() {
    this.registry = new Map();
  }

  register(definition) {
    const contract = createProviderContract(definition);
    this.registry.set(contract.id, contract);
    return contract;
  }

  registerMany(definitions = []) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  loadPlugins(plugins = []) {
    for (const plugin of plugins) {
      if (typeof plugin === 'function') {
        this.register(plugin());
      } else {
        this.register(plugin);
      }
    }
  }

  get(providerId) {
    return this.registry.get(providerId);
  }

  list() {
    return [...this.registry.values()];
  }

  createClient(config, logger) {
    const definition = this.get(config.aiProvider);
    if (!definition) {
      const supportedProviders = this.list()
        .map((item) => item.id)
        .sort()
        .join(', ');
      throw new Error(`Unsupported AI_PROVIDER: ${config.aiProvider}. Supported: ${supportedProviders}`);
    }

    if (definition.validateConfig) {
      definition.validateConfig(config);
    }

    const client = definition.createClient(config, logger);
    const providerName =
      typeof client.getProviderName === 'function' ? client.getProviderName.bind(client) : () => definition.id;
    const providerCapabilities =
      typeof client.getCapabilities === 'function' ? client.getCapabilities.bind(client) : () => ({});

    client.getProviderName = () => providerName() || definition.id;
    client.getCapabilities = () =>
      defineCapabilityMatrix({
        ...definition.capabilities,
        ...providerCapabilities()
      });

    return client;
  }
}

export function createProviderLoader() {
  return new ProviderLoader();
}
