import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIClient } from '../src/services/ai-client-factory.js';

test('gemini live provider exposes live audio capabilities', () => {
  const client = createAIClient({
    aiProvider: 'gemini-live',
    geminiLiveApiKey: 'key',
    geminiLiveBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requestTimeoutMs: 1000,
    aiMaxToolSteps: 1
  }, {});
  assert.equal(client.getCapabilities().liveAudio, true);
  assert.equal(client.getCapabilities().speechTranscription, true);
});
