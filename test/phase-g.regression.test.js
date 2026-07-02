import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureBuiltInAIProvidersRegistered, listAIProviderDefinitions } from '../src/services/ai-provider-registry.js';
import { DocumentParser } from '../src/services/document-parser.js';

function logger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

test('regression: built-in native providers stay available', () => {
  ensureBuiltInAIProvidersRegistered();
  const ids = new Set(listAIProviderDefinitions().map((item) => item.id));
  for (const expected of ['openai-compatible', 'anthropic', 'gemini', 'gemini-live', 'qwen', 'grok', 'deepseek', 'glm', 'doubao']) {
    assert.equal(ids.has(expected), true);
  }
});

test('regression: document parser keeps text and unsupported guards', async () => {
  const parser = new DocumentParser(
    { documentMaxBytes: 1024 * 1024, documentMaxChars: 5000, documentChunkChars: 300 },
    logger()
  );

  const ok = await parser.parse({
    filename: 'notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# title\nhello phase g')
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.meta.parser, 'text');
  assert.equal(ok.chunks.length >= 1, true);

  const unsupported = await parser.parse({
    filename: 'archive.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK')
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'DOCUMENT_TYPE_UNSUPPORTED');
});
