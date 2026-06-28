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
