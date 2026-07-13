import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIClient } from '../src/services/ai-client-factory.js';
import { createRequestAbort } from '../src/utils/request-abort.js';

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

test('request abort helper honors a shorter per-request deadline', async () => {
  const request = createRequestAbort({ timeoutMs: 40, fallbackTimeoutMs: 10000 });
  const startedAt = Date.now();
  try {
    await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }));
    assert.ok(Date.now() - startedAt < 500);
  } finally {
    request.dispose();
  }
});

test('gemini requests honor an inline cancellation signal', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => new Promise((resolve, reject) => {
    const signal = options.signal;
    const abort = () => reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });

  try {
    const client = createAIClient({
      aiProvider: 'gemini',
      geminiApiKey: 'key',
      geminiBaseUrl: 'https://example.test',
      requestTimeoutMs: 10000,
      aiMaxToolSteps: 1
    }, {});
    const controller = new AbortController();
    const pending = client.completeWithTools({
      model: 'gemini-test',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      signal: controller.signal,
      requestTimeoutMs: 1000
    });
    controller.abort();
    await assert.rejects(pending, (error) => error?.name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
