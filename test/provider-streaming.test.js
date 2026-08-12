import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleClient } from '../src/services/openai-compatible-client.js';
import { GeminiClient } from '../src/services/gemini-client.js';

function sseResponse(events) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  });
}

test('OpenAI-compatible chat streams provider deltas without losing whitespace', async () => {
  const originalFetch = globalThis.fetch;
  const payloads = [];
  globalThis.fetch = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return sseResponse([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] }
    ]);
  };

  try {
    const client = new OpenAICompatibleClient({
      aiBaseUrl: 'https://example.test/v1',
      aiApiKey: 'key',
      requestTimeoutMs: 1000,
      aiMaxToolSteps: 1,
      temperature: 0.2
    }, {});
    const previews = [];
    const result = await client.completeWithTools({
      model: 'chat-model',
      messages: [{ role: 'user', content: 'hello' }],
      onTextDelta: async (_delta, fullText) => previews.push(fullText)
    });

    assert.equal(payloads[0].stream, true);
    assert.equal(result.text, 'Hello world');
    assert.deepEqual(previews, ['Hello', 'Hello world']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gemini chat streams provider deltas into one final candidate', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return sseResponse([
      { candidates: [{ content: { parts: [{ text: '实时' }] } }] },
      { candidates: [{ content: { parts: [{ text: '输出' }] }, finishReason: 'STOP' }] }
    ]);
  };

  try {
    const client = new GeminiClient({
      geminiBaseUrl: 'https://example.test/v1beta',
      geminiApiKey: 'key',
      requestTimeoutMs: 1000,
      aiMaxToolSteps: 1,
      temperature: 0.2
    }, {});
    const previews = [];
    const result = await client.completeWithTools({
      model: 'gemini-test',
      messages: [{ role: 'user', content: 'hello' }],
      onTextDelta: async (_delta, fullText) => previews.push(fullText)
    });

    assert.match(requestedUrl, /:streamGenerateContent\?alt=sse&key=/);
    assert.equal(result.text, '实时输出');
    assert.deepEqual(previews, ['实时', '实时输出']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
