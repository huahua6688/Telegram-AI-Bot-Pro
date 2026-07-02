import { defineCapabilityMatrix } from './capability-matrix.js';

export function createProviderContract(definition) {
  if (!definition || typeof definition !== 'object') {
    throw new Error('Provider definition must be an object.');
  }
  if (!definition.id || typeof definition.id !== 'string') {
    throw new Error('Provider definition requires an id.');
  }
  if (typeof definition.createClient !== 'function') {
    throw new Error(`Provider ${definition.id} requires createClient.`);
  }

  return Object.freeze({
    ...definition,
    capabilities: defineCapabilityMatrix(definition.capabilities)
  });
}
