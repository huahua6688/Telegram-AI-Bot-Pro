import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIClient } from '../src/services/ai-client-factory.js';

test('gemini provider remains separate from gemini live', () => {
  const client = createAIClient({
    aiProvider: 'gemini',
    geminiApiKey: 'key',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requestTimeoutMs: 1000,
    aiMaxToolSteps: 1
  }, {});
  assert.equal(client.getCapabilities().vision, true);
  assert.equal(client.getCapabilities().liveAudio, false);
});
