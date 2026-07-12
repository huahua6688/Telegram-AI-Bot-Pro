import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformModesTelegramAIBot } from '../src/services/platform-modes-telegram-bot.js';

function createBot(overrides = {}) {
  const bot = Object.create(PlatformModesTelegramAIBot.prototype);
  bot.config = {
    miniAppEnabled: true,
    maxInputChars: 12000,
    maxOutputChars: 3500,
    adminUserIds: new Set(),
    allowedUserIds: new Set(),
    blockedUserIds: new Set(),
    guardDefaultAction: 'queue',
    enableSecretaryAutoReply: true,
    botCollaborationCooldownMs: 5000,
    ...overrides.config
  };
  bot.db = {
    findUser() { return undefined; },
    ...overrides.db
  };
  bot.logger = { info() {}, warn() {}, error() {} };
  bot.platformBotInfo = overrides.platformBotInfo || {};
  bot.businessConnections = new Map();
  bot.processedPlatformMessages = new Set();
  bot.botPairCooldowns = new Map();
  bot.terminalBotReplyIds = new Set();
  bot.bot = overrides.bot || { telegram: { async callApi() {} } };
  bot.getLocale = () => 'zh';
  bot.formatLogError = (error) => ({ detail: String(error?.message || error) });
  bot.formatUserFacingError = () => '暂时无法处理。';
  return Object.assign(bot, overrides.methods || {});
}

test('/help owns the five Telegram platform mode buttons while /whoami stays clean', async () => {
  const bot = createBot();
  const replies = [];
  await bot.handleHelp({
    reply: async (text, extra) => replies.push({ text, extra })
  });

  assert.equal(replies.length, 1);
  const buttons = replies[0].extra.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map((button) => button.text), [
    'Inline Mode',
    'Guest Chat Mode',
    'Guard Mode',
    'Secretary Mode',
    'Bot-to-Bot Communication'
  ]);
  assert.equal(bot.createWhoamiKeyboard({}, 'zh'), undefined);
  assert.match(replies[0].text, /Telegram 扩展模式/);
  assert.match(PlatformModesTelegramAIBot.prototype.constructor.toString(), /platform_mode:/);
  assert.doesNotMatch(PlatformModesTelegramAIBot.prototype.registerCommands.toString(), /platform_mode:/);
});

test('inline mode returns a personal, non-cached AI article', async () => {
  const bot = createBot({
    methods: {
      async completePlatformRequest({ text }) {
        assert.equal(text, '今日新闻');
        return '今天的重要新闻摘要。';
      }
    }
  });
  const answers = [];
  await bot.handleInlineQuery({
    update: {
      inline_query: {
        query: '今日新闻',
        from: { id: 11, language_code: 'zh-CN' }
      }
    },
    answerInlineQuery: async (results, extra) => answers.push({ results, extra })
  });

  assert.equal(answers.length, 1);
  assert.equal(answers[0].results[0].type, 'article');
  assert.equal(answers[0].results[0].input_message_content.message_text, '今天的重要新闻摘要。');
  assert.deepEqual(answers[0].extra, { cache_time: 0, is_personal: true });
});

test('guest mode answers once through answerGuestQuery without saving a conversation', async () => {
  const calls = [];
  const bot = createBot({
    bot: {
      telegram: {
        async callApi(method, payload) {
          calls.push({ method, payload });
        }
      }
    },
    db: {
      setConversation() {
        throw new Error('guest content must not be persisted');
      }
    },
    methods: {
      async completePlatformRequest({ text }) {
        assert.equal(text, '请解释这段内容');
        return '这是一次访客回答。';
      }
    }
  });

  await bot.handleGuestMessage({
    update: {
      guest_message: {
        guest_query_id: 'guest-1',
        text: '请解释这段内容',
        chat: { id: -1001 },
        guest_bot_caller_user: { id: 12, language_code: 'zh-CN' }
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'answerGuestQuery');
  assert.equal(calls[0].payload.guest_query_id, 'guest-1');
  assert.equal(calls[0].payload.result.input_message_content.message_text, '这是一次访客回答。');
});

test('guard mode declines blocked users, approves allowlisted users, and queues unknown users', () => {
  const bot = createBot({
    config: {
      blockedUserIds: new Set(['1']),
      allowedUserIds: new Set(['2'])
    }
  });

  assert.equal(bot.guardDecision({ from: { id: 1 } }), 'decline');
  assert.equal(bot.guardDecision({ from: { id: 2 } }), 'approve');
  assert.equal(bot.guardDecision({ from: { id: 3 } }), 'queue');
});

test('guard mode resolves a Telegram join request query', async () => {
  const calls = [];
  const bot = createBot({
    bot: {
      telegram: {
        async callApi(method, payload) {
          calls.push({ method, payload });
        }
      }
    }
  });

  await bot.handleGuardJoinRequest({
    update: {
      chat_join_request: {
        query_id: 'join-1',
        chat: { id: -1002 },
        from: { id: 99 }
      }
    }
  }, () => {
    throw new Error('handled guard queries must not fall through');
  });

  assert.deepEqual(calls, [{
    method: 'answerChatJoinRequestQuery',
    payload: { chat_join_request_query_id: 'join-1', result: 'queue' }
  }]);
});

test('secretary mode replies through the business connection without writing customer text to chat history', async () => {
  const calls = [];
  const bot = createBot({
    bot: {
      telegram: {
        async callApi(method, payload) {
          calls.push({ method, payload });
        }
      }
    },
    db: {
      setConversation() {
        throw new Error('customer content must not be persisted');
      }
    },
    methods: {
      async completePlatformRequest({ text, role }) {
        assert.equal(text, '请问今天营业吗？');
        assert.match(role, /business secretary/);
        return '您好，今天正常营业。';
      }
    }
  });
  bot.businessConnections.set('biz-1', {
    id: 'biz-1',
    is_enabled: true,
    rights: { can_reply: true },
    user: { id: 42, language_code: 'zh-CN' }
  });

  await bot.handleBusinessMessage({
    update: {
      business_message: {
        business_connection_id: 'biz-1',
        message_id: 7,
        text: '请问今天营业吗？',
        from: { id: 88 },
        chat: { id: 88 }
      }
    }
  });

  assert.equal(calls[0].method, 'sendChatAction');
  assert.equal(calls[1].method, 'sendMessage');
  assert.equal(calls[1].payload.business_connection_id, 'biz-1');
  assert.equal(calls[1].payload.text, '您好，今天正常营业。');
});

test('bot-to-bot messages require an explicit reply and terminal replies stop the loop', async () => {
  const prompts = [];
  const bot = createBot({
    methods: {
      async answerBotMessage(_ctx, prompt) {
        prompts.push(prompt);
      }
    }
  });
  bot.botUserId = '500';
  bot.botUsername = 'assistant_bot';

  await bot.handlePossibleBotMessage({
    from: { id: 600, is_bot: true },
    chat: { id: -1003 },
    message: { message_id: 10, text: 'unaddressed' }
  }, async () => {});
  assert.deepEqual(prompts, []);

  const addressed = {
    from: { id: 600, is_bot: true },
    chat: { id: -1003 },
    message: {
      message_id: 11,
      text: 'review this',
      reply_to_message: { message_id: 5, from: { id: 500, username: 'assistant_bot' } }
    }
  };
  await bot.handlePossibleBotMessage(addressed, async () => {});
  assert.deepEqual(prompts, ['review this']);

  bot.terminalBotReplyIds.add('-1003:5');
  prompts.length = 0;
  await bot.handlePossibleBotMessage(addressed, async () => {});
  assert.deepEqual(prompts, []);
});
