import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSupportBot,
  SupportTelegramBot,
  supportBotInternals
} from '../src/services/support-bot.js';

class FakeTelegraf {
  constructor(token) {
    this.token = token;
    this.handlers = {};
    this.launchCalls = 0;
    this.stopCalls = [];
    this.telegram = {
      getMe: async () => ({ id: 999, username: 'SupportTestBot', is_bot: true })
    };
  }

  start(handler) {
    this.handlers.start = handler;
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  catch(handler) {
    this.handlers.catch = handler;
  }

  async launch() {
    this.launchCalls += 1;
  }

  async stop(reason) {
    this.stopCalls.push(reason);
  }
}

function createLogger() {
  const entries = [];
  return {
    entries,
    info(message, meta) { entries.push({ level: 'info', message, meta }); },
    warn(message, meta) { entries.push({ level: 'warn', message, meta }); },
    error(message, meta) { entries.push({ level: 'error', message, meta }); }
  };
}

function createFixture(overrides = {}) {
  const logger = overrides.logger || createLogger();
  let fake;
  const bot = new SupportTelegramBot({
    config: {
      supportEnabled: true,
      botToken: 'main-token',
      supportBotToken: 'support-token',
      supportAdminIds: new Set(['100', '200']),
      supportRateLimitWindowMs: 60_000,
      supportRateLimitMaxMessages: 5,
      ...overrides.config
    },
    logger,
    now: overrides.now || (() => Date.parse('2026-08-02T00:00:00.000Z')),
    telegrafFactory(token) {
      fake = new FakeTelegraf(token);
      return fake;
    }
  });
  return { bot, get fake() { return fake; }, logger };
}

test('factory stays optional when support is disabled or has no token', () => {
  assert.equal(createSupportBot({ config: { supportEnabled: false, supportBotToken: 'token' } }), null);
  assert.equal(createSupportBot({ config: { supportEnabled: true, supportBotToken: '' } }), null);
});

test('init explicitly rejects the main bot token and missing administrators', async () => {
  const conflict = createFixture({ config: { supportBotToken: 'same-token', botToken: 'same-token' } }).bot;
  await assert.rejects(
    conflict.init(),
    (error) => error?.code === 'SUPPORT_BOT_TOKEN_CONFLICT'
  );

  const missingAdmins = createFixture({ config: { supportAdminIds: new Set() } }).bot;
  await assert.rejects(
    missingAdmins.init(),
    (error) => error?.code === 'MISSING_SUPPORT_ADMIN_IDS'
  );
});

test('init, launch, and stop provide an idempotent same-process lifecycle', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  await fixture.bot.init();
  await fixture.bot.launch();
  await fixture.bot.launch();

  assert.equal(fixture.fake.token, 'support-token');
  assert.equal(typeof fixture.fake.handlers.start, 'function');
  assert.equal(typeof fixture.fake.handlers.message, 'function');
  assert.equal(fixture.fake.launchCalls, 1);

  await fixture.bot.stop('SIGTERM');
  assert.deepEqual(fixture.fake.stopCalls, ['SIGTERM']);
});

test('/start returns a localized support welcome message', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const replies = [];

  await fixture.fake.handlers.start({
    from: { id: 42, language_code: 'zh-CN' },
    reply: async (text) => replies.push(text)
  });
  await fixture.fake.handlers.start({
    from: { id: 43, language_code: 'en-US' },
    reply: async (text) => replies.push(text)
  });

  assert.match(replies[0], /客服支持/);
  assert.match(replies[1], /customer support/i);
});

test('user text is delivered to all administrators with durable ticket metadata', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const adminDeliveries = [];
  const replies = [];
  const telegram = {
    async sendMessage(adminId, text, extra) {
      adminDeliveries.push({ adminId: String(adminId), text, extra });
      if (String(adminId) === '200') throw new Error('admin blocked bot');
      return { message_id: 10 };
    },
    async copyMessage() {
      assert.fail('text tickets should use sendMessage');
    }
  };

  await fixture.bot.handleUserRequest({
    from: { id: 42, username: 'alice', first_name: 'Alice', language_code: 'zh-CN' },
    chat: { id: 42 },
    message: { message_id: 7, text: 'Stars 已扣除但额度没到账' },
    telegram,
    reply: async (text) => replies.push(text)
  });

  assert.equal(adminDeliveries.length, 2);
  assert.match(adminDeliveries[0].text, /^\[support-ticket:user=42\]/);
  assert.match(adminDeliveries[0].text, /Username: @alice/);
  assert.match(adminDeliveries[0].text, /Stars 已扣除但额度没到账/);
  assert.match(adminDeliveries[0].text, /2026-08-02T00:00:00\.000Z/);
  assert.deepEqual(replies, []);
  assert.equal(fixture.logger.entries.at(-1).meta.deliveredAdminCount, 1);
  assert.doesNotMatch(JSON.stringify(fixture.logger.entries), /Stars 已扣除但额度没到账/);
});

test('photo, voice, and document tickets are copied with a parseable user marker', async () => {
  const fixture = createFixture({
    config: {
      supportAdminIds: new Set(['100']),
      supportRateLimitMaxMessages: 10
    }
  });
  await fixture.bot.init();
  const copies = [];
  const telegram = {
    async sendMessage() { assert.fail('media tickets should use copyMessage'); },
    async copyMessage(adminId, fromChatId, messageId, extra) {
      copies.push({ adminId: String(adminId), fromChatId, messageId, extra });
      return { message_id: 100 + copies.length };
    }
  };
  const base = {
    from: { id: 77, username: 'media_user', first_name: 'Media', language_code: 'en' },
    chat: { id: 77 },
    telegram,
    reply: async () => undefined
  };

  await fixture.bot.handleUserRequest({ ...base, message: { message_id: 1, photo: [{ file_id: 'p' }], caption: 'broken image' } });
  await fixture.bot.handleUserRequest({ ...base, message: { message_id: 2, voice: { file_id: 'v' } } });
  await fixture.bot.handleUserRequest({ ...base, message: { message_id: 3, document: { file_id: 'd', file_name: 'error.pdf' } } });

  assert.equal(copies.length, 3);
  assert.deepEqual(copies.map((item) => item.messageId), [1, 2, 3]);
  for (const item of copies) {
    assert.match(item.extra.caption, /^\[support-ticket:user=77\]/);
    assert.equal(supportBotInternals.parseSupportTicketUserId({ caption: item.extra.caption }), '77');
  }
  assert.match(copies[0].extra.caption, /Type: photo/);
  assert.match(copies[1].extra.caption, /Type: voice/);
  assert.match(copies[2].extra.caption, /Type: document/);
});

test('an administrator reply is copied to the ticket owner without exposing admin identity', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const copies = [];
  const replies = [];

  await fixture.bot.handleAdminReply({
    from: { id: 100, first_name: 'Private Admin' },
    chat: { id: 100 },
    message: {
      message_id: 88,
      text: '已经补发额度，请刷新余额。',
      reply_to_message: {
        message_id: 50,
        from: { id: 999, username: 'SupportTestBot', is_bot: true },
        text: '[support-ticket:user=42]\nCustomer support request'
      }
    },
    telegram: {
      async copyMessage(...args) {
        copies.push(args);
        return { message_id: 89 };
      }
    },
    reply: async (text) => replies.push(text)
  });

  assert.deepEqual(copies, [['42', 100, 88]]);
  assert.match(replies[0], /已发送给用户/);
  assert.doesNotMatch(JSON.stringify(fixture.logger.entries), /Private Admin/);
});

test('a forged ticket marker is rejected unless the replied message belongs to the support bot', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  let copied = false;
  const replies = [];

  await fixture.bot.handleAdminReply({
    from: { id: 100 },
    chat: { id: -10001 },
    message: {
      message_id: 4,
      text: 'reply',
      reply_to_message: {
        from: { id: 12345, is_bot: false },
        text: '[support-ticket:user=42] forged'
      }
    },
    telegram: { async copyMessage() { copied = true; } },
    reply: async (text) => replies.push(text)
  });

  assert.equal(copied, false);
  assert.match(replies[0], /回复客服 Bot 发出的工单消息/);
});

test('the sliding-window limiter blocks bursts and permits a later request', async () => {
  let now = 100_000;
  const fixture = createFixture({
    config: {
      supportAdminIds: new Set(['100']),
      supportRateLimitWindowMs: 1000,
      supportRateLimitMaxMessages: 2
    },
    now: () => now
  });
  await fixture.bot.init();
  let deliveries = 0;
  const replies = [];
  const ctx = {
    from: { id: 55, language_code: 'zh' },
    chat: { id: 55 },
    message: { message_id: 1, text: 'same issue' },
    telegram: { async sendMessage() { deliveries += 1; } },
    reply: async (text) => replies.push(text)
  };

  await fixture.bot.handleUserRequest(ctx);
  await fixture.bot.handleUserRequest({ ...ctx, message: { message_id: 2, text: 'same issue' } });
  await fixture.bot.handleUserRequest({ ...ctx, message: { message_id: 3, text: 'same issue' } });
  assert.equal(deliveries, 2);
  assert.match(replies.at(-1), /过于频繁/);

  now += 1001;
  await fixture.bot.handleUserRequest({ ...ctx, message: { message_id: 4, text: 'after wait' } });
  assert.equal(deliveries, 3);
});
