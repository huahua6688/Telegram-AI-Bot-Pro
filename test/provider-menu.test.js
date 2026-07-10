import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TelegramAIBot } from '../src/services/telegram-bot.js';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

test('provider menu exposes requested provider callbacks', () => {
  for (const provider of ['gemini', 'groq', 'openrouter', 'github-models', 'huggingface', 'mistral']) {
    assert.match(source, new RegExp(`'${provider}'`));
  }
  assert.match(source, /`ai:p:\$\{providerId\}`/);
  assert.match(source, /ai:auto/);
});

test('provider auth failures are not reported as missing configuration', () => {
  const error = new Error('All configured AI providers failed: anthropic/auth');
  error.code = 'AI_PROVIDERS_FAILED';
  error.cause = new Error('AI request failed (401): invalid x-api-key');
  error.attemptedProviders = [
    {
      providerId: 'anthropic',
      status: 'auth',
      message: 'invalid x-api-key'
    }
  ];

  const message = TelegramAIBot.prototype.formatUserFacingError.call({}, error, 'en');

  assert.match(message, /authentication failed/i);
  assert.doesNotMatch(message, /No AI provider is usable/i);
});

test('setup-only provider failures still explain missing configuration', () => {
  const error = new Error('No usable AI provider is configured: gemini/unconfigured');
  error.code = 'NO_USABLE_AI_PROVIDER';
  error.attemptedProviders = [
    {
      providerId: 'gemini',
      status: 'unconfigured',
      message: 'GEMINI_API_KEY is empty'
    }
  ];

  const message = TelegramAIBot.prototype.formatUserFacingError.call({}, error, 'en');

  assert.match(message, /No AI provider is usable/i);
});
