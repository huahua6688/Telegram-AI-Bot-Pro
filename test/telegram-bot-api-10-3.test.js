import assert from 'node:assert/strict';
import test from 'node:test';

import { TelegramAIBot } from '../src/services/telegram-bot.js';

test('group administrators persist a private rich welcome message for each new member', async () => {
  const meta = new Map();
  const replies = [];
  const calls = [];
  const fakeBot = {
    config: { enableRichMessages: true },
    db: {
      getMeta(key) { return meta.get(key) || ''; },
      setMeta(key, value) { meta.set(key, value); }
    },
    botUserId: '999',
    botUsername: 'example_bot',
    canManageGroupSettings: async () => true,
    getWelcomeSettings: TelegramAIBot.prototype.getWelcomeSettings,
    renderWelcomeText: TelegramAIBot.prototype.renderWelcomeText,
    getLocale: () => 'zh',
    t: (_locale, key) => key,
    getWelcomePermission: async () => true,
    logger: { warn() {} },
    formatLogError: (error) => ({ message: error.message })
  };
  const commandContext = {
    chat: { id: -100, type: 'supergroup', title: '测试群' },
    from: { id: 7 },
    message: { text: '/welcome set 欢迎 {name} 加入 {chat}' },
    reply: async (text) => replies.push(text)
  };
  await TelegramAIBot.prototype.handleWelcomeCommand.call(fakeBot, commandContext);
  assert.match(replies[0], /已保存/);
  assert.match(meta.get('telegram:welcome:-100'), /欢迎/);

  const joinContext = {
    chat: { id: -100, type: 'supergroup', title: '测试群' },
    message: { new_chat_members: [{ id: 42, first_name: 'Alice', is_bot: false }] },
    telegram: { async callApi(method, payload) { calls.push({ method, payload }); return { message_id: 1 }; } }
  };
  const handled = await TelegramAIBot.prototype.handleWelcomeMembers.call(fakeBot, joinContext);
  assert.equal(handled, true);
  assert.equal(calls[0].method, 'sendRichMessage');
  assert.equal(calls[0].payload.ephemeral_message_parameters.receiver_user_id, 42);
  assert.match(calls[0].payload.rich_message.html, /Alice/);
  assert.match(calls[0].payload.rich_message.html, /测试群/);
  assert.match(calls[0].payload.rich_message.html, /type="url"/);
  assert.match(calls[0].payload.rich_message.html, /billing:store/);
});

test('terminal Agent tasks deliver an ephemeral embedded report document in groups', async () => {
  const apiCalls = [];
  const documents = [];
  const fakeBot = {
    config: { enableRichMessages: true },
    buildAgentReport: TelegramAIBot.prototype.buildAgentReport,
    db: {
      listAgentTaskEvents() { return [{ type: 'succeeded', payload: { ok: true }, createdAt: '2026-08-27T00:00:00Z' }]; },
      listProviderUsageCosts() { return [{ costUsd: 0.25, billedCredits: 30 }]; }
    },
    bot: {
      telegram: {
        async sendDocument(chatId, document, extra) {
          documents.push({ chatId, document, extra });
          return { ephemeral_message_id: 'ephemeral-1', document: { file_id: 'telegram-file-1' } };
        },
        async callApi(method, payload) {
          apiCalls.push({ method, payload });
          return { message_id: 88 };
        }
      }
    },
    logger: { warn() {} },
    formatLogError: (error) => ({ message: error.message })
  };
  const task = {
    id: '12345678-1234-4123-8123-123456789abc',
    chatId: '-100',
    userId: '42',
    repository: 'owner/repo',
    branch: 'ai/task',
    status: 'succeeded',
    prompt: 'Fix it',
    result: { text: 'Pull request created.' }
  };

  await TelegramAIBot.prototype.sendAgentReportDocument.call(fakeBot, task);
  assert.equal(documents[0].extra.ephemeral_message_parameters.receiver_user_id, 42);
  assert.match(documents[0].document.source.toString('utf8'), /Cost \(USD\): 0\.250000/);
  assert.equal(apiCalls[0].method, 'sendRichMessage');
  assert.equal(apiCalls[0].payload.ephemeral_message_parameters.receiver_user_id, 42);
  assert.deepEqual(apiCalls[0].payload.rich_message.media, [
    { id: 'agent_report', media: { type: 'document', media: 'telegram-file-1' } }
  ]);
  assert.match(apiCalls[0].payload.rich_message.html, /tg:\/\/document\?id=agent_report/);
  assert.equal(apiCalls[1].method, 'deleteEphemeralMessage');
});

function createBillingBot({ rich = true } = {}) {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = {
    enableRichMessages: rich,
    enableVideo: false,
    starsPaymentsEnabled: true,
    starsProducts: [{
      id: 'starter',
      title: '入门包',
      titleEn: 'Starter',
      description: '入门额度',
      descriptionEn: 'Starter credits',
      price: 30,
      credits: {
        chat: 10,
        vision: 5,
        image_generation: 1,
        tts: 2,
        live_voice: 1,
        video: 0
      }
    }]
  };
  bot.botUsername = 'main_ai_bot';
  bot.getLocale = () => 'zh';
  bot.isAdmin = () => false;
  bot.logger = { warn() {}, info() {} };
  bot.formatLogError = (error) => ({ message: String(error?.message || error) });
  return bot;
}

test('group purchase callback edits only the clicking user ephemeral message with a compact table', async () => {
  const bot = createBillingBot();
  const calls = [];
  const answers = [];
  const replies = [];
  await bot.handleBillingCallback({
    match: ['billing:store', 'store'],
    chat: { id: -10010, type: 'supergroup' },
    from: { id: 71 },
    callbackQuery: {
      id: 'callback-71',
      message: { chat: { id: -10010 }, ephemeral_message_id: 701 }
    },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        return true;
      }
    },
    answerCbQuery: async (...args) => answers.push(args),
    reply: async (...args) => replies.push(args)
  });

  assert.equal(replies.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'editEphemeralMessageText');
  assert.equal(calls[0].payload.receiver_user_id, 71);
  assert.equal(calls[0].payload.ephemeral_message_id, 701);
  const table = calls[0].payload.rich_message.blocks.find((block) => block.type === 'table');
  assert.equal(table.is_compact, true);
  assert.equal(table.is_bordered, true);
  assert.equal(answers.length, 1);
});

test('a normal group callback creates a replacement ephemeral purchase menu for its sender', async () => {
  const bot = createBillingBot();
  const calls = [];
  await bot.handleBillingCallback({
    match: ['billing:store', 'store'],
    chat: { id: -10015, type: 'group' },
    from: { id: 73 },
    callbackQuery: {
      id: 'callback-73',
      message: { chat: { id: -10015 }, message_id: 703 }
    },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        return { ephemeral_message_id: 704 };
      }
    },
    answerCbQuery: async () => undefined,
    reply: async () => assert.fail('the purchase menu must stay private')
  });

  assert.equal(calls[0].method, 'sendRichMessage');
  assert.deepEqual(calls[0].payload.ephemeral_message_parameters, {
    receiver_user_id: 73,
    callback_query_id: 'callback-73',
    replace_callback_query_message: true
  });
});

test('ephemeral purchase fallback redirects to private chat and never posts packages publicly', async () => {
  const bot = createBillingBot();
  const calls = [];
  const answers = [];
  const replies = [];
  await bot.handleBillingCallback({
    match: ['billing:store', 'store'],
    chat: { id: -10011, type: 'group' },
    from: { id: 72 },
    callbackQuery: {
      id: 'callback-72',
      message: { chat: { id: -10011 }, ephemeral_message_id: 702 }
    },
    telegram: {
      async callApi(method) {
        calls.push(method);
        throw new Error('Bad Request: method not found');
      }
    },
    answerCbQuery: async (text, extra) => answers.push({ text, extra }),
    reply: async (...args) => replies.push(args)
  });

  assert.deepEqual(calls, ['editEphemeralMessageText', 'sendRichMessage']);
  assert.equal(replies.length, 0);
  assert.equal(answers.length, 1);
  assert.equal(answers[0].extra.url, 'https://t.me/main_ai_bot?start=buy');
  assert.doesNotMatch(answers[0].text, /入门包|30|余额/);
});

test('group purchase without a callback never falls back to a public reply or private fan-out', async () => {
  const bot = createBillingBot();
  const calls = [];
  const replies = [];
  const result = await bot.handleStarsStore({
    chat: { id: -10016, type: 'supergroup' },
    from: { id: 74 },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        throw new Error('ephemeral unsupported');
      }
    },
    reply: async (...args) => replies.push(args)
  });

  assert.equal(result, null);
  assert.equal(replies.length, 0);
  assert.equal(calls.every((call) => call.payload.chat_id === -10016), true);
  assert.equal(calls.some((call) => call.payload.chat_id === 74), false);
});

test('two users ephemeral purchase states keep receiver and message identifiers isolated', async () => {
  const bot = createBillingBot();
  const calls = [];
  for (const [userId, ephemeralId] of [[81, 801], [82, 802]]) {
    await bot.handleBillingCallback({
      match: ['billing:store', 'store'],
      chat: { id: -10012, type: 'supergroup' },
      from: { id: userId },
      callbackQuery: {
        id: `callback-${userId}`,
        message: { chat: { id: -10012 }, ephemeral_message_id: ephemeralId }
      },
      telegram: {
        async callApi(method, payload) {
          calls.push({ method, payload });
          return true;
        }
      },
      answerCbQuery: async () => undefined,
      reply: async () => assert.fail('ephemeral state must not become a public reply')
    });
  }

  assert.deepEqual(calls.map((item) => [
    item.payload.receiver_user_id,
    item.payload.ephemeral_message_id
  ]), [[81, 801], [82, 802]]);
});

test('rich welcome failure falls back to private deep links without public purchase data', async () => {
  const calls = [];
  const fakeBot = {
    config: { enableRichMessages: true },
    db: {
      getMeta() { return JSON.stringify({ enabled: true, text: '欢迎 {name}' }); }
    },
    botUserId: '999',
    botUsername: 'main_ai_bot',
    getWelcomeSettings: TelegramAIBot.prototype.getWelcomeSettings,
    renderWelcomeText: TelegramAIBot.prototype.renderWelcomeText,
    logger: { warn() {} },
    formatLogError: (error) => ({ message: String(error?.message || error) })
  };
  await TelegramAIBot.prototype.handleWelcomeMembers.call(fakeBot, {
    chat: { id: -10013, type: 'supergroup', title: '隐私群' },
    message: { new_chat_members: [{ id: 91, first_name: 'New user', is_bot: false }] },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        if (method === 'sendRichMessage') throw new Error('unknown method');
        return { ephemeral_message_id: 901 };
      }
    }
  });

  assert.deepEqual(calls.map((call) => call.method), ['sendRichMessage', 'sendMessage']);
  const fallback = calls[1].payload;
  assert.equal(fallback.ephemeral_message_parameters.receiver_user_id, 91);
  const buttons = fallback.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map((button) => button.url), [
    'https://t.me/main_ai_bot?start=welcome',
    'https://t.me/main_ai_bot?start=buy'
  ]);
  assert.equal(buttons.some((button) => button.callback_data), false);
  assert.doesNotMatch(fallback.text, /套餐|余额|订单|Stars/);
});

test('Agent rich state folds long details and Community service events are filtered', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.db = { listProviderUsageCosts() { return []; } };
  const task = {
    id: '12345678-1234-4123-8123-123456789abc',
    status: 'running',
    repository: 'owner/repo',
    branch: 'agent/work',
    result: { text: 'line 1\nline 2\nline 3' }
  };
  const display = bot.getAgentTaskDisplay(task);
  const rich = bot.buildAgentTaskRichMessage(task, display);
  assert.match(rich.html, /<blockquote expandable>/);
  assert.match(rich.html, /line 1<br>line 2/);

  const events = [];
  bot.logger = { info(message, meta) { events.push({ message, meta }); } };
  await bot.handleIncomingMessage({
    chat: { id: -10014, type: 'supergroup' },
    message: { community_chat_joined: { community: { id: 1, name: 'Example' } } },
    reply: async () => assert.fail('Community service events must not reach normal replies')
  });
  assert.equal(events[0].meta.event, 'community_chat_joined');
});

test('compact table capability falls back to the existing plain private store', async () => {
  const bot = createBillingBot();
  const replies = [];
  await bot.handleStarsStore({
    chat: { id: 101, type: 'private' },
    from: { id: 101 },
    telegram: {
      async callApi() {
        throw new Error('Bad Request: unsupported rich blocks');
      }
    },
    reply: async (text, extra) => replies.push({ text, extra })
  });
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /购买额度/);
  assert.equal(replies[0].extra.reply_markup.inline_keyboard.length > 0, true);
});

test('group /help and /whoami replies are isolated ephemeral messages', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.bot = { telegram: null };
  bot.logger = { warn() {} };
  bot.formatLogError = (error) => ({ message: String(error?.message || error) });
  const calls = [];

  for (const [userId, ephemeralMessageId, command] of [
    [101, 1001, '/help'],
    [102, 1002, '/whoami']
  ]) {
    let publicReplies = 0;
    const ctx = {
      chat: { id: -10020, type: 'supergroup' },
      from: { id: userId },
      message: { message_id: userId, ephemeral_message_id: ephemeralMessageId, text: command },
      telegram: {
        async callApi(method, payload) {
          calls.push({ method, payload });
          return { ephemeral_message_id: ephemeralMessageId + 10 };
        }
      },
      reply: async () => { publicReplies += 1; }
    };

    await bot.withEphemeralGroupCommandReply(ctx, () =>
      ctx.reply(`reply for ${userId}`, { reply_parameters: { message_id: userId } })
    );
    assert.equal(publicReplies, 0);
  }

  assert.deepEqual(calls.map((call) => call.method), ['sendMessage', 'sendMessage']);
  assert.deepEqual(calls.map((call) => [
    call.payload.ephemeral_message_parameters.receiver_user_id,
    call.payload.reply_parameters.ephemeral_message_id
  ]), [[101, 1001], [102, 1002]]);
  assert.equal(calls.some((call) => call.payload.reply_parameters.message_id), false);
});

test('private command reply stays normal and group ephemeral failure never starts a private chat', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.bot = { telegram: null };
  bot.logger = { warn() {} };
  bot.formatLogError = (error) => ({ message: String(error?.message || error) });
  let privateReplies = 0;
  const privateCtx = {
    chat: { id: 201, type: 'private' },
    from: { id: 201 },
    reply: async () => { privateReplies += 1; }
  };
  await bot.withEphemeralGroupCommandReply(privateCtx, () => privateCtx.reply('private'));
  assert.equal(privateReplies, 1);

  let publicReplies = 0;
  const calls = [];
  const groupCtx = {
    chat: { id: -10021, type: 'group' },
    from: { id: 202 },
    message: { ephemeral_message_id: 2002 },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        throw new Error('ephemeral unsupported');
      }
    },
    reply: async () => { publicReplies += 1; }
  };
  assert.equal(await bot.withEphemeralGroupCommandReply(groupCtx, () => groupCtx.reply('secret')), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.chat_id, -10021);
  assert.equal(calls[0].payload.ephemeral_message_parameters.receiver_user_id, 202);
  assert.equal(publicReplies, 0);
});

test('one group command can address only its sender and never enumerates other users', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.bot = { telegram: null };
  bot.logger = { warn() {} };
  bot.formatLogError = (error) => ({ message: String(error?.message || error) });
  bot.db = {
    listUsers() { assert.fail('a group command must never enumerate users'); }
  };
  let publicReplies = 0;
  const calls = [];
  const ctx = {
    chat: { id: -10022, type: 'supergroup' },
    from: { id: 203 },
    message: { ephemeral_message_id: 2003 },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        return { ephemeral_message_id: 2004 };
      }
    },
    reply: async () => { publicReplies += 1; }
  };
  await bot.withEphemeralGroupCommandReply(ctx, () => ctx.reply('secret'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.chat_id, -10022);
  assert.deepEqual(calls[0].payload.ephemeral_message_parameters, { receiver_user_id: 203 });
  assert.equal(calls.some((call) => call.payload.chat_id === 203), false);
  assert.equal(publicReplies, 0);
});

test('/whoami shows only the requested private and group identity fields', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { maxOutputChars: 4096, miniAppEnabled: true };
  bot.getLocale = () => 'zh';
  bot.isAdmin = (ctx) => Number(ctx.from?.id) === 301;
  bot.createWhoamiKeyboard = () => undefined;

  const privateReplies = [];
  await bot.handleWhoami({
    chat: { id: 301, type: 'private' },
    from: { id: 301, username: 'alice' },
    message: { message_id: 1 },
    reply: async (text) => privateReplies.push(text)
  });
  assert.match(privateReplies[0], /用户 ID：301/);
  assert.match(privateReplies[0], /用户名：@alice/);
  assert.match(privateReplies[0], /Bot 管理员：是/);
  assert.doesNotMatch(privateReplies[0], /聊天 ID|群组 ID|Zeabur|ADMIN_USER_IDS/);

  const groupReplies = [];
  await bot.handleWhoami({
    chat: { id: -10030, type: 'supergroup' },
    from: { id: 302, username: 'bob' },
    message: { message_id: 2 },
    reply: async (text) => groupReplies.push(text)
  });
  assert.match(groupReplies[0], /用户 ID：302/);
  assert.match(groupReplies[0], /群组 ID：-10030/);
  assert.match(groupReplies[0], /用户名：@bob/);
  assert.match(groupReplies[0], /Bot 管理员：否/);
  assert.doesNotMatch(groupReplies[0], /聊天 ID|Zeabur|ADMIN_USER_IDS/);
});
