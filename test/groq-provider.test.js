import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIClient } from '../src/services/ai-client-factory.js';

test('groq provider has independent provider id', () => {
  const client = createAIClient({
    aiProvider: 'groq',
    groqApiKey: 'key',
    groqBaseUrl: 'https://api.groq.com/openai/v1',
    requestTimeoutMs: 1000,
    aiMaxToolSteps: 1
  }, {});
  assert.equal(client.getProviderName(), 'groq');
  assert.equal(client.getCapabilities().chat, true);
});
