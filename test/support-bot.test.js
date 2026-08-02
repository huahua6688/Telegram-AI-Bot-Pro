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
    this.actions = [];
    this.launchCalls = 0;
    this.stopCalls = [];
    this.telegram = {
      getMe: async () => ({ id: 999, username: 'SupportTestBot', is_bot: true })
    };
  }

  start(handler) { this.handlers.start = handler; }
  on(event, handler) { this.handlers[event] = handler; }
  action(pattern, handler) { this.actions.push({ pattern, handler }); }
  catch(handler) { this.handlers.catch = handler; }
  async launch(onLaunch) { this.launchCalls += 1; onLaunch?.(); }
  async stop(reason) { this.stopCalls.push(reason); }
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

function createTelegram() {
  let nextMessageId = 100;
  return {
    sent: [],
    copied: [],
    edited: [],
    async sendMessage(chatId, text, extra) {
      const result = { message_id: nextMessageId++ };
      this.sent.push({ chatId: String(chatId), text, extra, result });
      return result;
    },
    async copyMessage(chatId, fromChatId, messageId, extra) {
      const result = { message_id: nextMessageId++ };
      this.copied.push({ chatId: String(chatId), fromChatId: String(fromChatId), messageId, extra, result });
      return result;
    },
    async editMessageText(chatId, messageId, inlineMessageId, text, extra) {
      this.edited.push({ chatId: String(chatId), messageId, inlineMessageId, text, extra });
      return true;
    }
  };
}

function createFixture(overrides = {}) {
  const logger = overrides.logger || createLogger();
  let fake;
  let ticketSequence = 0;
  const bot = new SupportTelegramBot({
    config: {
      supportEnabled: true,
      botToken: 'main-token',
      supportBotToken: 'support-token',
      supportAdminIds: new Set(['100', '200', '300']),
      supportRateLimitWindowMs: 60_000,
      supportRateLimitMaxMessages: 10,
      ...overrides.config
    },
    logger,
    now: overrides.now || (() => Date.parse('2026-08-02T00:00:00.000Z')),
    ticketIdFactory: overrides.ticketIdFactory || (() => `abc000000${++ticketSequence}`),
    telegrafFactory(token) {
      fake = new FakeTelegraf(token);
      return fake;
    }
  });
  return { bot, get fake() { return fake; }, logger };
}

function userContext(telegram, message = { message_id: 7, text: 'Stars 已扣除但额度没到账' }) {
  const replies = [];
  return {
    replies,
    ctx: {
      from: { id: 42, username: 'alice', first_name: 'Alice', language_code: 'zh-CN' },
      chat: { id: 42 },
      message,
      telegram,
      reply: async (text) => replies.push(text)
    }
  };
}

function actionContext(telegram, adminId) {
  const answers = [];
  const markups = [];
  return {
    answers,
    markups,
    ctx: {
      from: { id: Number(adminId) },
      chat: { id: Number(adminId) },
      telegram,
      answerCbQuery: async (text, extra) => answers.push({ text, extra }),
      editMessageReplyMarkup: async (markup) => markups.push(markup)
    }
  };
}

test('factory stays optional when support is disabled or has no token', () => {
  assert.equal(createSupportBot({ config: { supportEnabled: false, supportBotToken: 'token' } }), null);
  assert.equal(createSupportBot({ config: { supportEnabled: true, supportBotToken: '' } }), null);
});

test('init validates configuration and preserves launch readiness callback', async () => {
  const conflict = createFixture({ config: { supportBotToken: 'same-token', botToken: 'same-token' } }).bot;
  await assert.rejects(conflict.init(), (error) => error?.code === 'SUPPORT_BOT_TOKEN_CONFLICT');

  const fixture = createFixture();
  await fixture.bot.init();
  let ready = 0;
  await fixture.bot.launch(() => { ready += 1; });
  assert.equal(ready, 1);
  assert.equal(fixture.fake.launchCalls, 1);
  assert.equal(fixture.fake.actions.length, 6);
});

test('/start contains localized privacy warnings', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const replies = [];
  await fixture.fake.handlers.start({ from: { id: 42, language_code: 'zh-CN' }, reply: async (text) => replies.push(text) });
  await fixture.fake.handlers.start({ from: { id: 43, language_code: 'en-US' }, reply: async (text) => replies.push(text) });
  assert.match(replies[0], /登录验证码/);
  assert.match(replies[0], /助记词/);
  assert.match(replies[1], /login codes/i);
  assert.match(replies[1], /seed phrases/i);
});

test('new ticket sends protected summaries without identity or message content', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const telegram = createTelegram();
  const { ctx, replies } = userContext(telegram);
  await fixture.bot.handleUserRequest(ctx);

  assert.equal(telegram.sent.length, 3);
  for (const delivery of telegram.sent) {
    assert.equal(delivery.extra.protect_content, true);
    assert.match(delivery.text, /等待接单/);
    assert.match(delivery.text, /完整内容仅向当前负责客服显示/);
    assert.doesNotMatch(delivery.text, /42|alice|Alice|Stars|额度没到账/);
  }
  assert.deepEqual(replies, []);
  assert.doesNotMatch(JSON.stringify(fixture.logger.entries), /Stars 已扣除|alice|Alice/);
  const ticket = fixture.bot.getActiveTicket('42');
  assert.equal(ticket.messageRefs.length, 1);
  assert.equal(Object.hasOwn(ticket.messageRefs[0], 'text'), false);
});

test('first admin claims atomically and only claimant receives private history', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const telegram = createTelegram();
  await fixture.bot.handleUserRequest(userContext(telegram).ctx);
  const ticket = fixture.bot.getActiveTicket('42');

  const first = actionContext(telegram, '100');
  await fixture.bot.handleClaim(first.ctx, ticket.ticketId);
  assert.equal(ticket.status, 'assigned');
  assert.equal(ticket.assignedAdminId, '100');
  assert.equal(telegram.copied.length, 1);
  assert.equal(telegram.copied[0].chatId, '100');
  assert.equal(telegram.copied[0].extra.protect_content, true);

  const second = actionContext(telegram, '200');
  await fixture.bot.handleClaim(second.ctx, ticket.ticketId);
  assert.equal(ticket.assignedAdminId, '100');
  assert.equal(telegram.copied.length, 1);
  assert.match(second.answers.at(-1).text, /其他客服/);
});

test('follow-up content goes only to current owner', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const telegram = createTelegram();
  await fixture.bot.handleUserRequest(userContext(telegram).ctx);
  const ticket = fixture.bot.getActiveTicket('42');
  await fixture.bot.handleClaim(actionContext(telegram, '100').ctx, ticket.ticketId);
  telegram.copied.length = 0;

  const followUp = userContext(telegram, { message_id: 8, document: { file_id: 'd', file_name: 'private.pdf' } });
  await fixture.bot.handleUserRequest(followUp.ctx);
  assert.equal(telegram.copied.length, 1);
  assert.equal(telegram.copied[0].chatId, '100');
  assert.doesNotMatch(JSON.stringify(fixture.logger.entries), /private\.pdf/);
});

test('only current owner can reply and admin identity stays hidden', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const telegram = createTelegram();
  await fixture.bot.handleUserRequest(userContext(telegram).ctx);
  const ticket = fixture.bot.getActiveTicket('42');
  await fixture.bot.handleClaim(actionContext(telegram, '100').ctx, ticket.ticketId);
  const ownerCopy = telegram.copied.find((item) => item.chatId === '100');

  const blockedReplies = [];
  await fixture.bot.handleAdminReply({
    from: { id: 200, first_name: 'Other Admin' },
    chat: { id: 200 },
    message: { message_id: 501, text: 'duplicate', reply_to_message: { message_id: ticket.summaryDeliveries.get('200') } },
    telegram,
    reply: async (text) => blockedReplies.push(text)
  });
  assert.match(blockedReplies[0], /其他客服/);

  const ownerReplies = [];
  await fixture.bot.handleAdminReply({
    from: { id: 100, first_name: 'Private Admin' },
    chat: { id: 100 },
    message: { message_id: 502, text: '已经处理', reply_to_message: { message_id: ownerCopy.result.message_id } },
    telegram,
    reply: async (text) => ownerReplies.push(text)
  });
  const userDelivery = telegram.copied.at(-1);
  assert.equal(userDelivery.chatId, '42');
  assert.equal(userDelivery.extra.protect_content, true);
  assert.match(ownerReplies[0], /已发送给用户/);
  assert.doesNotMatch(JSON.stringify(fixture.logger.entries), /Private Admin|已经处理|duplicate/);
});

test('tickets support repeated transfer without duplicate historical delivery', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const telegram = createTelegram();
  await fixture.bot.handleUserRequest(userContext(telegram).ctx);
  const ticket = fixture.bot.getActiveTicket('42');
  await fixture.bot.handleClaim(actionContext(telegram, '100').ctx, ticket.ticketId);
  assert.equal(telegram.copied.filter((item) => item.chatId === '100').length, 1);

  await fixture.bot.handleTransfer(actionContext(telegram, '100').ctx, ticket.ticketId, 1);
  assert.equal(ticket.assignedAdminId, '200');
  assert.equal(telegram.copied.filter((item) => item.chatId === '200').length, 1);

  await fixture.bot.handleTransfer(actionContext(telegram, '200').ctx, ticket.ticketId, 0);
  assert.equal(ticket.assignedAdminId, '100');
  assert.equal(telegram.copied.filter((item) => item.chatId === '100').length, 1);
  assert.equal(ticket.transferHistory.length, 2);
});

test('return to queue, close, and create a new ticket', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const telegram = createTelegram();
  await fixture.bot.handleUserRequest(userContext(telegram).ctx);
  const first = fixture.bot.getActiveTicket('42');
  await fixture.bot.handleClaim(actionContext(telegram, '100').ctx, first.ticketId);
  await fixture.bot.handleReturnToQueue(actionContext(telegram, '100').ctx, first.ticketId);
  assert.equal(first.status, 'open');
  assert.equal(first.assignedAdminId, null);

  await fixture.bot.handleClaim(actionContext(telegram, '200').ctx, first.ticketId);
  await fixture.bot.handleClose(actionContext(telegram, '200').ctx, first.ticketId);
  assert.equal(first.status, 'closed');
  assert.equal(fixture.bot.getActiveTicket('42'), null);

  await fixture.bot.handleUserRequest(userContext(telegram, { message_id: 9, text: 'new problem' }).ctx);
  const second = fixture.bot.getActiveTicket('42');
  assert.notEqual(second.ticketId, first.ticketId);
});

test('stop clears non-persistent ticket state and old messages become invalid', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const telegram = createTelegram();
  await fixture.bot.handleUserRequest(userContext(telegram).ctx);
  await fixture.bot.launch();
  await fixture.bot.stop('SIGTERM');
  assert.equal(fixture.bot.tickets.size, 0);
  assert.equal(fixture.bot.activeTicketByUser.size, 0);
  assert.equal(fixture.bot.adminMessageIndex.size, 0);
});

test('sliding-window rate limiter remains active', async () => {
  let now = 100_000;
  const fixture = createFixture({
    config: { supportAdminIds: new Set(['100']), supportRateLimitWindowMs: 1000, supportRateLimitMaxMessages: 2 },
    now: () => now
  });
  await fixture.bot.init();
  const telegram = createTelegram();
  const replies = [];
  const base = {
    from: { id: 55, language_code: 'zh' },
    chat: { id: 55 },
    telegram,
    reply: async (text) => replies.push(text)
  };
  await fixture.bot.handleUserRequest({ ...base, message: { message_id: 1, text: 'one' } });
  await fixture.bot.handleUserRequest({ ...base, message: { message_id: 2, text: 'two' } });
  await fixture.bot.handleUserRequest({ ...base, message: { message_id: 3, text: 'three' } });
  assert.match(replies.at(-1), /过于频繁/);
  now += 1001;
  await fixture.bot.handleUserRequest({ ...base, message: { message_id: 4, text: 'four' } });
  assert.equal(fixture.bot.getActiveTicket('55').messageRefs.length, 3);
});

test('legacy parser helpers remain compatible without being used for authorization', () => {
  assert.equal(supportBotInternals.parseSupportTicketUserId({ text: '[support-ticket:user=42]' }), '42');
  assert.match(supportBotInternals.buildSupportTicketText({ user: { id: 42 }, message: { text: 'x' }, now: new Date(0) }), /user=42/);
});
