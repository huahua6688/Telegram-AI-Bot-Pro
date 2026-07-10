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

test('Gemini has working fallback models even when env does not configure them', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_MODEL = 'gemini-2.5-flash';
  delete process.env.AI_FALLBACK_MODELS;

  const config = loadConfig();
  assert.equal(config.defaultModel, 'gemini-2.5-flash');
  assert.ok(config.availableModels.includes('gemini-2.5-flash-lite'));
  assert.ok(config.availableModels.length >= 2);
});

test('loadConfig resolves gemini-live aliases and keys', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'google-live';
  process.env.GEMINI_API_KEY = 'gemini-shared-key';
  const config = loadConfig();
  assert.equal(config.aiProvider, 'gemini-live');
  assert.equal(config.geminiLiveApiKey, 'gemini-shared-key');
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

test('loadConfig parses tool policy and document parsing options', () => {
  resetEnv();
  process.env.TOOL_ALLOWED_NAMES = 'get_time,web_search';
  process.env.NETWORK_TOOL_SCOPE = 'admin';
  process.env.DOCUMENT_MAX_BYTES = '2048';
  const config = loadConfig();
  assert.equal(config.toolAllowedNames.has('get_time'), true);
  assert.equal(config.toolAllowedNames.has('web_search'), true);
  assert.equal(config.networkToolScope, 'admin');
  assert.equal(config.documentMaxBytes, 2048);
});

test('loadConfig parses admin API options', () => {
  resetEnv();
  process.env.ADMIN_API_ENABLED = 'true';
  process.env.ADMIN_API_PORT = '3900';
  process.env.ADMIN_API_PREFIX = '/admin/api/v2';
  process.env.ADMIN_API_TOKEN = 'token-123';
  const config = loadConfig();
  assert.equal(config.adminApiEnabled, true);
  assert.equal(config.adminApiPort, 3900);
  assert.equal(config.adminApiPrefix, '/admin/api/v2');
  assert.equal(config.adminApiToken, 'token-123');
});
