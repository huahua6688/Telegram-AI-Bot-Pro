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
      supportSuperAdminIds: new Set(['100']),
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

function userContext(telegram, message = { message_id: 7, text: 'Stars 已扣除但额度没到账' }, userId = 42) {
  const replies = [];
  return {
    replies,
    ctx: {
      from: { id: Number(userId), username: 'alice', first_name: 'Alice', language_code: 'zh-CN' },
      chat: { id: Number(userId) },
      message,
      telegram,
      reply: async (text) => replies.push(text)
    }
  };
}

const copyableSupportCases = [
  ['text', { text: 'plain support message' }],
  ['photo', { photo: [{ file_id: 'photo-1' }], caption: 'photo caption' }],
  ['voice', { voice: { file_id: 'voice-1' }, caption: 'voice caption' }],
  ['document', { document: { file_id: 'document-1', file_name: 'report.pdf' }, caption: 'document caption' }],
  ['video', { video: { file_id: 'video-1' }, caption: 'video caption' }],
  ['video_note', { video_note: { file_id: 'video-note-1' } }],
  ['audio', { audio: { file_id: 'audio-1', title: 'Audio' }, caption: 'audio caption' }],
  ['animation', { animation: { file_id: 'animation-1' }, document: { file_id: 'animation-document-1' }, caption: 'GIF caption' }],
  ['sticker', { sticker: { file_id: 'sticker-1', emoji: '👍' } }],
  ['location', { location: { latitude: 3.139, longitude: 101.6869 } }],
  ['venue', { venue: { title: 'Help desk', address: 'Kuala Lumpur' }, location: { latitude: 3.139, longitude: 101.6869 } }],
  ['contact', { contact: { phone_number: '+60123456789', first_name: 'Alice' } }],
  ['poll', { poll: { id: 'poll-1', type: 'regular', question: 'Which issue?', options: [] } }],
  ['dice', { dice: { emoji: '🎲', value: 6 } }],
  ['live_photo', { live_photo: { photo: [], video: {} }, photo: [{ file_id: 'live-photo-preview' }] }],
  ['rich_message', { rich_message: { html: '<b>Rich support message</b>' } }],
  ['story', { story: { chat: { id: 42 }, id: 9 } }],
  ['checklist', { checklist: { title: 'Support checklist', tasks: [] } }],
  ['game', { game: { title: 'Support game', description: 'Game details', photo: [] } }]
];

const nonCopyableSupportCases = [
  ['invoice', { invoice: { title: 'Invoice' } }],
  ['paid_media', { paid_media: { star_count: 1, paid_media: [] } }],
  ['giveaway', { giveaway: { winner_count: 1 } }],
  ['giveaway_winners', { giveaway_winners: { winner_count: 1, winners: [] } }],
  ['successful_payment', { successful_payment: { currency: 'XTR', total_amount: 1 } }],
  ['refunded_payment', { refunded_payment: { currency: 'XTR', total_amount: 1 } }],
  ['service_message', { new_chat_members: [{ id: 77, first_name: 'System user' }] }]
];

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
  assert.equal(fixture.fake.botInfo?.username, 'SupportTestBot');
  let ready = 0;
  await fixture.bot.launch(() => { ready += 1; });
  assert.equal(ready, 1);
  assert.equal(fixture.fake.launchCalls, 1);
  assert.equal(fixture.fake.actions.length, 6);
});

test('support polling automatically recovers after a deployment conflict', async () => {
  const fixture = createFixture({
    config: {
      telegramStartupRetryBaseMs: 1,
      telegramStartupRetryMaxMs: 1
    }
  });
  await fixture.bot.init();

  let launchCalls = 0;
  let releasePolling;
  fixture.fake.launch = () => {
    launchCalls += 1;
    if (launchCalls === 1) {
      const error = new Error('409: Conflict: terminated by other getUpdates request');
      error.response = { error_code: 409 };
      return Promise.reject(error);
    }
    return new Promise((resolve) => { releasePolling = resolve; });
  };
  fixture.fake.stop = async (reason) => {
    fixture.fake.stopCalls.push(reason);
    releasePolling?.();
  };

  let ready = 0;
  const launchPromise = fixture.bot.launch(() => { ready += 1; });
  for (let index = 0; index < 30 && launchCalls < 2; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(ready, 1);
  assert.equal(launchCalls, 2);
  assert.equal(fixture.bot.getStatus().online, true);
  assert.equal(fixture.bot.getStatus().state, 'online');
  assert.equal(fixture.bot.getStatus().restartCount, 1);
  assert.equal(fixture.bot.getStatus().lastErrorCode, 409);
  assert.match(fixture.bot.getStatus().lastErrorAt, /^\d{4}-\d{2}-\d{2}T/);

  await fixture.bot.stop('TEST');
  await launchPromise;
  assert.equal(fixture.bot.getStatus().state, 'stopped');
});

test('/start sends only one concise localized greeting', async () => {
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

  assert.deepEqual(replies, [
    '你好，请问有什么可以帮你的？',
    'Hello, how can we help you?'
  ]);
});

test('level-one admin sees identity while support agents stay anonymous', async () => {
  const fixture = createFixture();
  await fixture.bot.init();

  const telegram = createTelegram();
  const { ctx, replies } = userContext(telegram);

  await fixture.bot.handleUserRequest(ctx);

  assert.equal(telegram.sent.length, 3);
  assert.deepEqual(replies, []);

  const levelOneSummary = telegram.sent.find(
    (delivery) => delivery.chatId === '100'
  );

  const supportSummaries = telegram.sent.filter(
    (delivery) =>
      delivery.chatId === '200' ||
      delivery.chatId === '300'
  );

  assert.ok(levelOneSummary);
  assert.equal(
    levelOneSummary.extra.protect_content,
    true
  );

  assert.match(
    levelOneSummary.text,
    /\u4e00\u7ea7\u7ba1\u7406\u5458\u53ef\u89c1\u7528\u6237\u4fe1\u606f/
  );
  assert.match(
    levelOneSummary.text,
    /\u7528\u6237 ID\uff1a42/
  );
  assert.match(levelOneSummary.text, /@alice/);
  assert.match(
    levelOneSummary.text,
    /\u59d3\u540d\uff1aAlice/
  );
  assert.match(levelOneSummary.text, /zh-CN/);

  // ?????????????????????
  assert.doesNotMatch(
    levelOneSummary.text,
    /Stars|\u989d\u5ea6\u6ca1\u5230\u8d26/
  );

  assert.equal(supportSummaries.length, 2);

  for (const delivery of supportSummaries) {
    assert.equal(delivery.extra.protect_content, true);
    assert.doesNotMatch(
      delivery.text,
      /42|alice|Alice|Stars|\u989d\u5ea6\u6ca1\u5230\u8d26/
    );
  }

  assert.doesNotMatch(
    JSON.stringify(fixture.logger.entries),
    /Stars|alice|Alice/
  );

  const ticket = fixture.bot.getActiveTicket('42');

  assert.equal(ticket.messageRefs.length, 1);
  assert.equal(
    Object.hasOwn(ticket.messageRefs[0], 'text'),
    false
  );
  assert.equal(ticket.userProfile.userId, '42');
  assert.equal(ticket.userProfile.username, 'alice');
});

for (const [expectedType, payload] of copyableSupportCases) {
  test(`private support records and copies ${expectedType} messages`, async () => {
    const fixture = createFixture({ config: { supportAdminIds: new Set(['100']) } });
    await fixture.bot.init();
    const telegram = createTelegram();
    const message = { message_id: 700, ...payload };

    await fixture.fake.handlers.message({
      ...userContext(telegram, message).ctx,
      chat: { id: 42, type: 'private' }
    });

    const ticket = fixture.bot.getActiveTicket('42');
    assert.ok(ticket);
    assert.equal(ticket.messageRefs.length, 1);
    assert.equal(ticket.messageRefs[0].type, expectedType);
    assert.equal(ticket.messageRefs[0].messageId, 700);

    await fixture.bot.handleClaim(actionContext(telegram, '100').ctx, ticket.ticketId);
    assert.equal(telegram.copied.length, 1);
    assert.equal(telegram.copied[0].chatId, '100');
    assert.equal(telegram.copied[0].fromChatId, '42');
    assert.equal(telegram.copied[0].messageId, 700);
    assert.deepEqual(telegram.copied[0].extra, {
      protect_content: true,
      reply_parameters: {
        message_id: telegram.sent.find((entry) => /新的用户消息/.test(entry.text))?.result.message_id,
        allow_sending_without_reply: true
      }
    });
  });
}

test('quiz polls are accepted only when Telegram exposes the correct options', () => {
  assert.equal(supportBotInternals.supportMessageType({
    poll: { type: 'quiz', correct_option_ids: [1] }
  }), 'poll');
  assert.equal(supportBotInternals.supportMessageType({
    poll: { type: 'quiz' }
  }), 'unsupported');
});

for (const [label, payload] of nonCopyableSupportCases) {
  test(`private support rejects ${label} without creating a ticket`, async () => {
    const fixture = createFixture({ config: { supportAdminIds: new Set(['100']) } });
    await fixture.bot.init();
    const telegram = createTelegram();
    const replies = [];

    await fixture.fake.handlers.message({
      chat: { id: 42, type: 'private' },
      from: { id: 42, language_code: 'zh-CN' },
      message: { message_id: 701, ...payload },
      telegram,
      reply: async (text) => replies.push(text)
    });

    assert.equal(fixture.bot.tickets.size, 0);
    assert.equal(fixture.bot.rateLimitHits.size, 0);
    assert.equal(telegram.copied.length, 0);
    assert.match(replies[0], /支付和系统消息无法转发/);
  });
}

test('bot messages are ignored before ticket creation and rate limiting', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const telegram = createTelegram();
  const replies = [];

  await fixture.fake.handlers.message({
    chat: { id: 42, type: 'private' },
    from: { id: 42, is_bot: true },
    message: { message_id: 702, video: { file_id: 'bot-video' } },
    telegram,
    reply: async (text) => replies.push(text)
  });

  assert.equal(fixture.bot.tickets.size, 0);
  assert.equal(fixture.bot.rateLimitHits.size, 0);
  assert.equal(telegram.copied.length, 0);
  assert.equal(replies.length, 0);
});

test('Telegram copy rejection keeps the message in history and replies politely', async () => {
  const fixture = createFixture({ config: { supportAdminIds: new Set(['100']) } });
  await fixture.bot.init();
  const telegram = createTelegram();
  await fixture.bot.handleUserRequest(userContext(telegram).ctx);
  const ticket = fixture.bot.getActiveTicket('42');
  await fixture.bot.handleClaim(actionContext(telegram, '100').ctx, ticket.ticketId);

  telegram.copyMessage = async () => {
    const error = new Error("Bad Request: message can't be copied");
    error.response = { description: "Bad Request: message can't be copied" };
    throw error;
  };
  const followUp = userContext(telegram, {
    message_id: 703,
    sticker: { file_id: 'protected-sticker' }
  });

  await assert.doesNotReject(fixture.bot.handleUserRequest(followUp.ctx));
  assert.equal(ticket.messageRefs.length, 2);
  assert.equal(ticket.messageRefs[1].type, 'sticker');
  assert.equal(ticket.messageRefs[1].copyStatus, 'unsupported');
  assert.equal(fixture.bot.getActiveTicket('42'), ticket);
  assert.ok(telegram.sent.some((entry) => entry.chatId === '42' && /无法把具体内容复制给客服/.test(entry.text)));
  assert.ok(telegram.sent.some((entry) => entry.chatId === '100' && /已记录/.test(entry.text)));
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

test('one admin safely handles multiple tickets by replying to the matching message', async () => {
  const fixture = createFixture();
  await fixture.bot.init();

  const telegram = createTelegram();

  await fixture.bot.handleUserRequest(
    userContext(
      telegram,
      { message_id: 7, text: 'first user problem' },
      42
    ).ctx
  );

  await fixture.bot.handleUserRequest(
    userContext(
      telegram,
      { message_id: 17, text: 'second user problem' },
      43
    ).ctx
  );

  const firstTicket = fixture.bot.getActiveTicket('42');
  const secondTicket = fixture.bot.getActiveTicket('43');

  assert.ok(firstTicket);
  assert.ok(secondTicket);
  assert.notEqual(firstTicket.ticketId, secondTicket.ticketId);

  // ?????????????
  await fixture.bot.handleClaim(
    actionContext(telegram, '100').ctx,
    firstTicket.ticketId
  );

  await fixture.bot.handleClaim(
    actionContext(telegram, '100').ctx,
    secondTicket.ticketId
  );

  assert.equal(firstTicket.assignedAdminId, '100');
  assert.equal(secondTicket.assignedAdminId, '100');

  const adminCopies = telegram.copied.filter(
    (item) => item.chatId === '100'
  );

  assert.equal(adminCopies.length, 2);

  // ????????????????????
  const blockedReplies = [];
  const copiedBeforeBlockedReply = telegram.copied.length;

  await fixture.bot.handleAdminReply({
    from: { id: 100 },
    chat: { id: 100 },
    message: {
      message_id: 700,
      text: 'message without ticket reply'
    },
    telegram,
    reply: async (text) => blockedReplies.push(text)
  });

  assert.equal(telegram.copied.length, copiedBeforeBlockedReply);
  assert.match(
    blockedReplies[0],
    /\u8bf7\u76f4\u63a5\u56de\u590d/
  );

  // ???????????????? 42
  const firstReplies = [];

  await fixture.bot.handleAdminReply({
    from: { id: 100 },
    chat: { id: 100 },
    message: {
      message_id: 701,
      text: 'reply for first user',
      reply_to_message: {
        message_id: adminCopies[0].result.message_id
      }
    },
    telegram,
    reply: async (text) => firstReplies.push(text)
  });

  // ???????????????? 43
  const secondReplies = [];

  await fixture.bot.handleAdminReply({
    from: { id: 100 },
    chat: { id: 100 },
    message: {
      message_id: 702,
      text: 'reply for second user',
      reply_to_message: {
        message_id: adminCopies[1].result.message_id
      }
    },
    telegram,
    reply: async (text) => secondReplies.push(text)
  });

  const userDeliveries = telegram.copied.filter(
    (item) => item.chatId === '42' || item.chatId === '43'
  );

  assert.equal(userDeliveries.length, 2);

  assert.equal(userDeliveries[0].chatId, '42');
  assert.equal(userDeliveries[0].messageId, 701);

  assert.equal(userDeliveries[1].chatId, '43');
  assert.equal(userDeliveries[1].messageId, 702);

  assert.match(
    firstReplies[0],
    /\u5df2\u53d1\u9001\u7ed9\u7528\u6237/
  );

  assert.match(
    secondReplies[0],
    /\u5df2\u53d1\u9001\u7ed9\u7528\u6237/
  );
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
  assert.equal(fixture.bot.tickets.has(first.ticketId), false);
  assert.equal(
    [...fixture.bot.adminMessageIndex.values()].includes(first.ticketId),
    false
  );

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

test('ticket auto closes when user stays silent after an admin reply', async () => {
  let now = Date.parse(
    '2026-08-02T00:00:00.000Z'
  );

  const fixture = createFixture({
    config: {
      supportTicketAutoCloseMinutes: 1
    },
    now: () => now
  });

  await fixture.bot.init();

  const telegram = createTelegram();

  await fixture.bot.handleUserRequest(
    userContext(telegram).ctx
  );

  const ticket =
    fixture.bot.getActiveTicket('42');

  await fixture.bot.handleClaim(
    actionContext(telegram, '100').ctx,
    ticket.ticketId
  );

  const ownerCopy = telegram.copied.find(
    (item) => item.chatId === '100'
  );

  await fixture.bot.handleAdminReply({
    from: { id: 100 },
    chat: { id: 100 },
    message: {
      message_id: 900,
      text: 'please confirm',
      reply_to_message: {
        message_id:
          ownerCopy.result.message_id
      }
    },
    telegram,
    reply: async () => {}
  });

  assert.ok(ticket.autoCloseAt);
  assert.equal(
    fixture.bot.ticketAutoCloseTimers.has(
      ticket.ticketId
    ),
    true
  );

  now += 60_001;

  const closed =
    await fixture.bot.handleTicketAutoClose(
      telegram,
      ticket.ticketId
    );

  assert.equal(closed, true);
  assert.equal(ticket.status, 'closed');
  assert.equal(
    fixture.bot.getActiveTicket('42'),
    null
  );
  assert.equal(fixture.bot.tickets.has(ticket.ticketId), false);
  assert.equal(
    [...fixture.bot.adminMessageIndex.values()].includes(ticket.ticketId),
    false
  );
});

test('user reply cancels pending automatic closure', async () => {
  const fixture = createFixture({
    config: {
      supportTicketAutoCloseMinutes: 1
    }
  });

  await fixture.bot.init();

  const telegram = createTelegram();

  await fixture.bot.handleUserRequest(
    userContext(telegram).ctx
  );

  const ticket =
    fixture.bot.getActiveTicket('42');

  await fixture.bot.handleClaim(
    actionContext(telegram, '100').ctx,
    ticket.ticketId
  );

  const ownerCopy = telegram.copied.find(
    (item) => item.chatId === '100'
  );

  await fixture.bot.handleAdminReply({
    from: { id: 100 },
    chat: { id: 100 },
    message: {
      message_id: 901,
      text: 'waiting for user',
      reply_to_message: {
        message_id:
          ownerCopy.result.message_id
      }
    },
    telegram,
    reply: async () => {}
  });

  assert.ok(ticket.autoCloseAt);

  await fixture.bot.handleUserRequest(
    userContext(
      telegram,
      {
        message_id: 8,
        text: 'user replied'
      },
      42
    ).ctx
  );

  assert.equal(ticket.autoCloseAt, null);
  assert.equal(
    fixture.bot.ticketAutoCloseTimers.has(
      ticket.ticketId
    ),
    false
  );
  assert.equal(ticket.status, 'assigned');
});

test('ticket with removed owner returns to the queue', async () => {
  const fixture = createFixture();
  await fixture.bot.init();

  const telegram = createTelegram();

  await fixture.bot.handleUserRequest(
    userContext(telegram).ctx
  );

  const ticket =
    fixture.bot.getActiveTicket('42');

  ticket.status = 'assigned';
  ticket.assignedAdminId = '999999';

  await fixture.bot.handleUserRequest(
    userContext(
      telegram,
      {
        message_id: 8,
        text: 'still need help'
      },
      42
    ).ctx
  );

  assert.equal(ticket.status, 'open');
  assert.equal(ticket.assignedAdminId, null);

  assert.ok(
    fixture.logger.entries.some(
      (entry) =>
        entry.message ===
        'Support ticket owner removed from configuration'
    )
  );
});

test('message labels show identity only to level-one administrators', async () => {
  const fixture = createFixture();
  await fixture.bot.init();

  const telegram = createTelegram();

  await fixture.bot.handleUserRequest(
    userContext(
      telegram,
      {
        message_id: 7,
        text: 'first user'
      },
      42
    ).ctx
  );

  const firstTicket =
    fixture.bot.getActiveTicket('42');

  await fixture.bot.handleClaim(
    actionContext(telegram, '100').ctx,
    firstTicket.ticketId
  );

  const levelOneLabel = telegram.sent.find(
    (item) =>
      item.chatId === '100' &&
      /\u8bf7\u76f4\u63a5\u56de\u590d\u4e0b\u65b9/.test(
        item.text
      )
  );

  assert.ok(levelOneLabel);
  assert.match(levelOneLabel.text, /@alice/);
  assert.match(levelOneLabel.text, /Alice/);
  assert.match(
    levelOneLabel.text,
    /\u7528\u6237 ID\uff1a42/
  );

  await fixture.bot.handleUserRequest(
    userContext(
      telegram,
      {
        message_id: 17,
        text: 'second user'
      },
      43
    ).ctx
  );

  const secondTicket =
    fixture.bot.getActiveTicket('43');

  await fixture.bot.handleClaim(
    actionContext(telegram, '200').ctx,
    secondTicket.ticketId
  );

  const levelTwoLabel = telegram.sent.find(
    (item) =>
      item.chatId === '200' &&
      /\u8bf7\u76f4\u63a5\u56de\u590d\u4e0b\u65b9/.test(
        item.text
      )
  );

  assert.ok(levelTwoLabel);
  assert.match(
    levelTwoLabel.text,
    /\u533f\u540d\u8bbf\u5ba2/
  );
  assert.doesNotMatch(
    levelTwoLabel.text,
    /@alice|Alice|\u7528\u6237 ID/
  );
});

test('support bot ignores ordinary group messages before rate limiting or ticket creation', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const calls = [];
  const replies = [];

  await fixture.fake.handlers.message({
    chat: { id: -10001, type: 'supergroup' },
    from: { id: 41, first_name: 'Group user' },
    message: { message_id: 1, text: '客服在吗' },
    telegram: { async callApi(method, payload) { calls.push({ method, payload }); } },
    reply: async (...args) => replies.push(args)
  });

  assert.equal(calls.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(fixture.bot.tickets.size, 0);
  assert.equal(fixture.bot.rateLimitHits.size, 0);
});

test('@support bot and /support stay completely silent in groups', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const calls = [];
  const replies = [];
  const telegram = {
    async callApi(method, payload) {
      calls.push({ method, payload });
      return { ephemeral_message_id: calls.length };
    }
  };
  const base = {
    chat: { id: -10002, type: 'supergroup' },
    telegram,
    reply: async (...args) => replies.push(args)
  };

  await fixture.fake.handlers.message({
    ...base,
    from: { id: 42, first_name: 'Alice' },
    message: { message_id: 2, text: '@SupportTestBot' }
  });
  await fixture.fake.handlers.message({
    ...base,
    from: { id: 43, first_name: 'Bob' },
    message: { message_id: 3, text: '/support@SupportTestBot' }
  });
  await fixture.fake.handlers.message({
    ...base,
    from: { id: 44, first_name: 'Other bot user' },
    message: { message_id: 4, text: '/support@DifferentBot' }
  });

  assert.equal(replies.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(fixture.bot.tickets.size, 0);
  assert.equal(fixture.bot.rateLimitHits.size, 0);
});

test('support bot ignores group media and all channel updates', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const calls = [];
  const replies = [];
  const telegram = { async callApi(method, payload) { calls.push({ method, payload }); } };
  const mediaMessages = copyableSupportCases
    .filter(([type]) => type !== 'text')
    .map(([, payload], index) => ({
      message_id: 10 + index,
      ...payload,
      ...(payload.caption ? { caption: `${payload.caption} @SupportTestBot` } : {})
    }));
  for (const message of mediaMessages) {
    await fixture.fake.handlers.message({
      chat: { id: -10003, type: 'group' },
      from: { id: 44 },
      message,
      telegram,
      reply: async (...args) => replies.push(args)
    });
  }
  await fixture.fake.handlers.message({
    chat: { id: -10004, type: 'channel' },
    from: { id: 45 },
    message: { message_id: 13, text: '/support@SupportTestBot' },
    telegram,
    reply: async (...args) => replies.push(args)
  });

  assert.equal(calls.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(fixture.bot.tickets.size, 0);
  assert.equal(fixture.bot.rateLimitHits.size, 0);
});

test('private support creates isolated tickets while the backend rejects group calls', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const telegram = createTelegram();

  const blocked = await fixture.bot.handleUserRequest({
    chat: { id: -10005, type: 'group' },
    from: { id: 50 },
    message: { message_id: 20, text: 'must not create a ticket' },
    telegram,
    reply: async () => assert.fail('group backend guard must not reply')
  });
  assert.equal(blocked, false);
  assert.equal(fixture.bot.rateLimitHits.size, 0);

  for (const userId of [51, 52]) {
    await fixture.fake.handlers.message({
      chat: { id: userId, type: 'private' },
      from: { id: userId, first_name: `User ${userId}`, language_code: 'zh-CN' },
      message: { message_id: userId, text: `private issue ${userId}` },
      telegram,
      reply: async () => undefined
    });
  }

  const first = fixture.bot.getActiveTicket('51');
  const second = fixture.bot.getActiveTicket('52');
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.ticketId, second.ticketId);
  assert.equal(first.userId, '51');
  assert.equal(second.userId, '52');
  assert.equal(first.messageRefs[0].chatId, '51');
  assert.equal(second.messageRefs[0].chatId, '52');
});

test('private support prompts use force_reply without changing the greeting', async () => {
  const fixture = createFixture();
  await fixture.bot.init();
  const replies = [];
  await fixture.fake.handlers.start({
    chat: { id: 61, type: 'private' },
    from: { id: 61, language_code: 'zh-CN' },
    reply: async (text, extra) => replies.push({ text, extra })
  });
  assert.equal(replies[0].text, '你好，请问有什么可以帮你的？');
  assert.equal(replies[0].extra.reply_markup.force_reply, true);
  assert.match(replies[0].extra.reply_markup.input_field_placeholder, /描述/);
});

test('legacy parser helpers remain compatible without being used for authorization', () => {
  assert.equal(supportBotInternals.parseSupportTicketUserId({ text: '[support-ticket:user=42]' }), '42');
  assert.match(supportBotInternals.buildSupportTicketText({ user: { id: 42 }, message: { text: 'x' }, now: new Date(0) }), /user=42/);
});
