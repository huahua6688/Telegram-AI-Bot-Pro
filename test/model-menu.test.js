import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TelegramAIBot } from '../src/services/telegram-bot.js';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

test('model menu uses index callback data instead of raw model id', () => {
  assert.match(source, /`ai:m:\$\{index\}`/);
  assert.doesNotMatch(source, /`ai:m:\$\{model\}`/);
});

test('model menu exposes a localized automatic selection', () => {
  const bot = {
    getProviderModelsForMenu: () => ['model-a'],
    createSettingsNavigationRows: () => []
  };

  const english = TelegramAIBot.prototype.createAIModelKeyboard.call(bot, 'auto', '', 'en');
  const chinese = TelegramAIBot.prototype.createAIModelKeyboard.call(bot, 'auto', '', 'zh');
  assert.deepEqual(english.reply_markup.inline_keyboard[0][0], {
    text: '🤖 Auto select',
    callback_data: 'ai:auto',
    hide: false
  });
  assert.deepEqual(chinese.reply_markup.inline_keyboard[0][0], {
    text: '🤖 自动选择',
    callback_data: 'ai:auto',
    hide: false
  });
});

test('automatic settings panel hides the concrete default model', () => {
  const panel = TelegramAIBot.prototype.formatAISettingsPanel.call(
    {
      config: { aiProvider: 'gemini', defaultModel: 'concrete-default' },
      getAIProviderLabel: (providerId) => providerId,
      providerManager: { listProviders: () => [] }
    },
    {
      providerId: 'auto',
      modelId: 'concrete-default',
      autoRouting: true,
      fallbackEnabled: true
    },
    'en'
  );

  assert.match(panel, /Current provider: Automatic/);
  assert.match(panel, /Current model: Automatic/);
  assert.doesNotMatch(panel, /concrete-default/);
});

test('fixed model under auto provider remains visible in the settings panel', () => {
  const panel = TelegramAIBot.prototype.formatAISettingsPanel.call(
    {
      config: { aiProvider: 'auto', defaultModel: 'default-model' },
      getAIProviderLabel: (providerId) => providerId === 'auto' ? 'Auto' : providerId,
      providerManager: { listProviders: () => [] }
    },
    {
      providerId: 'auto',
      modelId: 'fixed-model',
      autoRouting: false,
      manualModel: true,
      fallbackEnabled: false
    },
    'en'
  );

  assert.match(panel, /Current provider: Auto/);
  assert.match(panel, /Current model: fixed-model/);
});

test('automatic model callback restores provider failover', async () => {
  let storedPatch;
  const bot = {
    config: { enableProviderFallback: true },
    db: {
      setUserAISettings(userId, patch) {
        assert.equal(userId, 42);
        storedPatch = patch;
        return patch;
      }
    },
    getLocale: () => 'en',
    getEffectiveAISettings: () => ({
      providerId: 'auto',
      modelId: 'fallback-model',
      autoRouting: true,
      fallbackEnabled: false
    }),
    formatAISettingsPanel: () => 'panel',
    createAIProviderKeyboard: () => ({ reply_markup: { inline_keyboard: [] } }),
    editAssistantMessageText: async () => undefined
  };

  await TelegramAIBot.prototype.handleAISettingsCallback.call(bot, {
    match: ['', 'auto'],
    from: { id: 42 },
    answerCbQuery: async () => undefined
  });

  assert.deepEqual(storedPatch, {
    providerId: '',
    modelId: '',
    fallbackEnabled: true
  });
});
