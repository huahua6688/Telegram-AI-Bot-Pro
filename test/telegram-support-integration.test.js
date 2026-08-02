import assert from 'node:assert/strict';
import test from 'node:test';

import { TelegramAIBot } from '../src/services/telegram-bot.js';

function createBot(config = {}) {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = {
    miniAppEnabled: true,
    supportEnabled: true,
    supportBotUsername: 'ExampleSupportBot',
    supportContactUrl: '',
    maxOutputChars: 3500,
    adminUserIds: new Set(),
    ...config
  };
  bot.db = {
    findUser() { return null; }
  };
  bot.getLocale = () => 'zh';
  bot.buildHelpFeatureLines = () => [];
  return bot;
}

test('Mini App help still provides one direct customer-support button', async () => {
  const bot = createBot();
  const replies = [];

  await bot.handleHelp({
    from: { id: 42, language_code: 'zh-CN' },
    message: { message_id: 7 },
    async reply(text, extra) {
      replies.push({ text, extra });
    }
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /使用帮助/);
  assert.deepEqual(replies[0].extra.reply_markup.inline_keyboard, [[{
    text: '🧑‍💻 联系客服',
    url: 'https://t.me/ExampleSupportBot?start=support'
  }]]);
  assert.equal('remove_keyboard' in replies[0].extra.reply_markup, false);
});

test('the compact non-Mini-App menu appends customer support without replacing existing actions', () => {
  const bot = createBot({ miniAppEnabled: false });
  const keyboard = bot.createEssentialMenuKeyboard('en');
  const buttons = keyboard.reply_markup.inline_keyboard.flat();

  assert.ok(buttons.some((button) => button.callback_data === 'billing:store'));
  assert.ok(buttons.some((button) => button.callback_data === 'billing:balance'));
  assert.equal(
    buttons.filter((button) => button.url === 'https://t.me/ExampleSupportBot?start=support').length,
    1
  );
});

test('legacy Telegram quota paths use the unified free-chat default', async () => {
  const defaults = [];
  const bot = createBot({
    dailyQuota: 99,
    starsFreeQuota: { chat: 7 },
    supportEnabled: false
  });
  bot.db = {
    findUser() { return null; },
    getUserDailyQuota(userId, defaultQuota) {
      defaults.push(['read', String(userId), defaultQuota]);
      return { dailyQuota: defaultQuota, dailyQuotaOverride: null, usesGlobalQuota: true };
    },
    consumeDailyQuota(userId, defaultQuota) {
      defaults.push(['consume', String(userId), defaultQuota]);
      return { allowed: true, remaining: 6 };
    }
  };

  assert.equal(bot.getEffectiveDailyQuota(42), 7);
  const result = await bot.reserveUsageForUser(42, 'chat');

  assert.equal(result.allowed, true);
  assert.equal(result.legacy, true);
  assert.deepEqual(defaults, [
    ['read', '42', 7],
    ['consume', '42', 7]
  ]);
});
