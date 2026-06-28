import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

test('loadConfig defaults to openai-compatible provider', () => {
  resetEnv();
  delete process.env.AI_PROVIDER;
  const config = loadConfig();
  assert.equal(config.aiProvider, 'openai-compatible');
});

test('loadConfig resolves anthropic provider aliases and keys', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'claude';
  process.env.AI_API_KEY = 'shared-key';
  const config = loadConfig();
  assert.equal(config.aiProvider, 'anthropic');
  assert.equal(config.anthropicApiKey, 'shared-key');
});

test('loadConfig resolves gemini provider aliases and keys', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'google';
  process.env.GEMINI_API_KEY = 'gemini-key';
  const config = loadConfig();
  assert.equal(config.aiProvider, 'gemini');
  assert.equal(config.geminiApiKey, 'gemini-key');
});

test('loadConfig resolves first-batch native provider aliases', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'xai';
  let config = loadConfig();
  assert.equal(config.aiProvider, 'grok');

  process.env.AI_PROVIDER = 'tongyi';
  config = loadConfig();
  assert.equal(config.aiProvider, 'qwen');

  process.env.AI_PROVIDER = 'chatglm';
  config = loadConfig();
  assert.equal(config.aiProvider, 'glm');

  process.env.AI_PROVIDER = 'ark';
  config = loadConfig();
  assert.equal(config.aiProvider, 'doubao');
});

test('loadConfig supports provider-specific key fallback to AI_API_KEY', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_API_KEY = 'shared-key';
  const config = loadConfig();
  assert.equal(config.aiProvider, 'deepseek');
  assert.equal(config.deepseekApiKey, 'shared-key');
});

test('loadConfig defaults to SQLite storage and streaming replies', () => {
  resetEnv();
  delete process.env.DATABASE_FILE;
  delete process.env.DATA_FILE;
  delete process.env.ENABLE_STREAMING_REPLIES;
  const config = loadConfig();
  assert.match(config.databaseFile, /bot-data\.db$/);
  assert.match(config.legacyDataFile, /bot-data\.json$/);
  assert.equal(config.enableStreamingReplies, true);
});
