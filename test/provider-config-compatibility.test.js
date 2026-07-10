import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) process.env[key] = value;
}

test('legacy AI_PROVIDER and AI_MODEL remain compatible', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_MODEL = 'legacy-gemini-model';
  process.env.AI_FALLBACK_MODELS = 'legacy-fallback';
  const config = loadConfig();
  assert.equal(config.aiProvider, 'gemini');
  assert.equal(config.defaultModel, 'legacy-gemini-model');
  assert.deepEqual(config.availableModels.slice(0, 2), ['legacy-gemini-model', 'legacy-fallback']);
});
