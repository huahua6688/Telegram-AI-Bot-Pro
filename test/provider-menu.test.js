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

test('effective AI settings discard a retired persisted model', () => {
  const settings = TelegramAIBot.prototype.getEffectiveAISettings.call(
    {
      db: {
        getUserAISettings: () => ({
          providerId: 'gemini',
          modelId: 'gemini-retired-preview',
          fallbackEnabled: true
        })
      },
      config: {
        defaultAIProvider: 'gemini',
        aiProvider: 'gemini',
        defaultModel: 'gemini-2.5-flash',
        availableModels: ['gemini-2.5-flash']
      },
      providerManager: {
        getProviderModels: () => ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
      }
    },
    42
  );

  assert.equal(settings.modelId, 'gemini-2.5-flash');
});

test('effective AI settings preserve a configured persisted model', () => {
  const settings = TelegramAIBot.prototype.getEffectiveAISettings.call(
    {
      db: {
        getUserAISettings: () => ({
          providerId: 'gemini',
          modelId: 'gemini-2.5-flash-lite',
          fallbackEnabled: false
        })
      },
      config: {
        defaultAIProvider: 'gemini',
        aiProvider: 'gemini',
        defaultModel: 'gemini-2.5-flash',
        availableModels: ['gemini-2.5-flash']
      },
      providerManager: {
        getProviderModels: () => ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
      }
    },
    42
  );

  assert.equal(settings.modelId, 'gemini-2.5-flash-lite');
  assert.equal(settings.fallbackEnabled, false);
});

test('help only advertises configured multimodal capabilities', () => {
  const available = new Set(['vision']);
  const lines = TelegramAIBot.prototype.buildHelpFeatureLines.call(
    {
      config: {
        enableToolCalls: true,
        enableWebSearch: true,
        enableUrlFetch: true,
        visionProvider: 'gemini',
        imageProvider: 'openai-compatible',
        transcriptionProvider: 'gemini-live',
        ttsProvider: 'gemini-live'
      },
      hasConfiguredCapability: (capability) => available.has(capability),
      isConfiguredToolAllowed: () => true
    },
    'zh'
  );
  const help = lines.join('\n');

  assert.match(help, /实时信息/);
  assert.match(help, /图片识别/);
  assert.doesNotMatch(help, /- 图片创作/);
  assert.doesNotMatch(help, /- 语音：/);
  assert.match(help, /当前未配置或尚未实现：图片生成\/编辑、语音转写\/朗读/);
});

test('help does not advertise tools excluded by the configured allowlist', () => {
  const bot = {
    config: {
      enableToolCalls: true,
      enableWebSearch: true,
      enableUrlFetch: true,
      toolAllowedNames: new Set(['get_time'])
    },
    hasConfiguredCapability: () => false,
    isConfiguredToolAllowed: TelegramAIBot.prototype.isConfiguredToolAllowed
  };
  const help = TelegramAIBot.prototype.buildHelpFeatureLines.call(bot, 'zh').join('\n');

  assert.doesNotMatch(help, /- 实时信息/);
  assert.doesNotMatch(help, /- 文件和网页/);
  assert.match(help, /当前未配置或尚未实现：联网搜索/);
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

test('cooldown provider failures do not look like missing configuration', () => {
  const error = new Error('No usable AI provider is configured: gemini/cooldown');
  error.code = 'NO_USABLE_AI_PROVIDER';
  error.attemptedProviders = [
    {
      providerId: 'gemini',
      status: 'cooldown'
    }
  ];

  const message = TelegramAIBot.prototype.formatUserFacingError.call({}, error, 'en');

  assert.match(message, /cooling down/i);
  assert.doesNotMatch(message, /No AI provider is usable/i);
});

test('OpenRouter no-endpoint failures explain model availability', () => {
  const error = new Error('All configured AI providers failed: openrouter/model');
  error.code = 'AI_PROVIDERS_FAILED';
  error.cause = new Error('AI request failed (400): No endpoints found matching your request');
  error.attemptedProviders = [
    {
      providerId: 'openrouter',
      status: 'model',
      message: 'No endpoints found matching your request'
    }
  ];

  const message = TelegramAIBot.prototype.formatUserFacingError.call({}, error, 'en');

  assert.match(message, /model is unavailable/i);
});
