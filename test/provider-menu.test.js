import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

test('provider menu exposes requested provider callbacks', () => {
  for (const provider of ['gemini', 'groq', 'openrouter', 'github-models', 'huggingface', 'mistral']) {
    assert.match(source, new RegExp(`'${provider}'`));
  }
  assert.match(source, /`ai:p:\$\{providerId\}`/);
  assert.match(source, /ai:auto/);
});
