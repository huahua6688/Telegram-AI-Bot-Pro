import test from 'node:test';
import assert from 'node:assert/strict';
import { AIProviderManager } from '../src/services/ai-provider-manager.js';

test('provider health marks unconfigured and configured providers', () => {
  const manager = new AIProviderManager({
    config: {
      aiProvider: 'gemini',
      defaultModel: 'gemini-model',
      providerModels: { gemini: ['gemini-model'], groq: ['groq-model'] },
      availableModels: ['gemini-model'],
      aiProviderFallbackOrder: ['gemini', 'groq'],
      geminiApiKey: 'gemini-key',
      groqApiKey: ''
    },
    logger: { warn: () => {} },
    clientFactory: () => ({ getProviderName: () => 'gemini', getCapabilities: () => ({ chat: true }) })
  });

  const providers = manager.listProviders();
  assert.equal(providers.find((item) => item.id === 'gemini')?.status, 'healthy');
  assert.equal(providers.find((item) => item.id === 'groq')?.status, 'unconfigured');
});
