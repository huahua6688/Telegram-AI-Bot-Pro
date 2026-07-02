import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureBuiltInAIProvidersRegistered, listAIProviderDefinitions } from '../src/services/ai-provider-registry.js';
import { loadConfig } from '../src/config.js';

test('regression: built-in native providers stay available', () => {
  ensureBuiltInAIProvidersRegistered();
  const ids = new Set(listAIProviderDefinitions().map((item) => item.id));
  for (const expected of ['openai-compatible', 'anthropic', 'gemini', 'gemini-live', 'qwen', 'grok', 'deepseek', 'glm', 'doubao']) {
    assert.equal(ids.has(expected), true);
  }
});

test('regression: document parsing limits remain configurable', () => {
  const original = {
    DOCUMENT_MAX_BYTES: process.env.DOCUMENT_MAX_BYTES,
    DOCUMENT_MAX_CHARS: process.env.DOCUMENT_MAX_CHARS,
    DOCUMENT_CHUNK_CHARS: process.env.DOCUMENT_CHUNK_CHARS
  };
  process.env.DOCUMENT_MAX_BYTES = '1048576';
  process.env.DOCUMENT_MAX_CHARS = '5000';
  process.env.DOCUMENT_CHUNK_CHARS = '300';

  const config = loadConfig();
  assert.equal(config.documentMaxBytes, 1048576);
  assert.equal(config.documentMaxChars, 5000);
  assert.equal(config.documentChunkChars, 300);

  process.env.DOCUMENT_MAX_BYTES = original.DOCUMENT_MAX_BYTES;
  process.env.DOCUMENT_MAX_CHARS = original.DOCUMENT_MAX_CHARS;
  process.env.DOCUMENT_CHUNK_CHARS = original.DOCUMENT_CHUNK_CHARS;
});
