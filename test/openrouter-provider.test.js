import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIClient } from '../src/services/ai-client-factory.js';

test('openrouter provider keeps recommended headers', () => {
  const client = createAIClient({
    aiProvider: 'openrouter',
    openrouterApiKey: 'key',
    openrouterBaseUrl: 'https://openrouter.ai/api/v1',
    openrouterHttpReferer: 'https://example.com',
    openrouterAppTitle: 'Telegram AI Bot Pro',
    requestTimeoutMs: 1000,
    aiMaxToolSteps: 1
  }, {});
  assert.equal(client.getProviderName(), 'openrouter');
  assert.equal(client.nativeHeaders['HTTP-Referer'], 'https://example.com');
  assert.equal(client.nativeHeaders['X-Title'], 'Telegram AI Bot Pro');
});
