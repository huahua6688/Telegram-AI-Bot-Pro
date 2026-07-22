import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStarsProducts } from '../src/config.js';
import { TelegramAIBot } from '../src/services/telegram-bot.js';

function createBot(overrides = {}) {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = {
    adminUserIds: new Set(),
    dailyQuota: 0,
    enableVideo: false,
    starsPaymentsEnabled: true,
    starsOrderTtlMinutes: 60,
    starsFreeQuota: {
      chat: 0,
      vision: 0,
      image_generation: 0,
      tts: 0,
      live_voice: 0,
      video: 0
    },
    ...overrides.config
  };
  bot.db = { ...overrides.db };
  bot.logger = { warn() {}, error() {}, ...overrides.logger };
  bot.getLocale = overrides.getLocale || (() => 'en');
  bot.isAdmin = overrides.isAdmin || (() => false);
  bot.isAllowed = overrides.isAllowed || (() => true);
  bot.checkRateLimit = overrides.checkRateLimit || (() => true);
  bot.formatLogError = (error) => ({ detail: String(error?.message || error) });
  bot.bot = overrides.bot || { telegram: { async callApi() {} } };
  return bot;
}

function productFromEnvironment(t) {
  const previous = process.env.STARS_PRODUCTS_JSON;
  process.env.STARS_PRODUCTS_JSON = JSON.stringify([{
    id: 'starter',
    title: 'Starter',
    titleEn: 'Starter',
    description: 'Starter credits',
    descriptionEn: 'Starter credits',
    price: 73,
    credits: { chat: 10, vision: 2, image_generation: 1, tts: 1, live_voice: 1, video: 0 }
  }]);
  t.after(() => {
    if (previous === undefined) delete process.env.STARS_PRODUCTS_JSON;
    else process.env.STARS_PRODUCTS_JSON = previous;
  });
  return parseStarsProducts(process.env.STARS_PRODUCTS_JSON);
}

test('Stars invoice uses the payer identity, XTR, an empty provider token, and configured product price', async (t) => {
  const products = productFromEnvironment(t);
  const sent = [];
  const created = [];
  const bot = createBot({
    config: { starsProducts: products },
    db: {
      createStarOrder(input) {
        created.push(input);
        return { invoicePayload: 'stars:invoice-1' };
      },
      async write() {}
    }
  });

  await bot.sendStarsInvoice({
    from: { id: 9001 },
    chat: { id: -100123 },
    telegram: {
      async sendInvoice(chatId, invoice) {
        sent.push({ chatId, invoice });
      }
    },
    reply: async () => assert.fail('a valid product should send an invoice')
  }, 'starter');

  assert.equal(created.length, 1);
  assert.equal(created[0].userId, '9001');
  assert.equal(created[0].amount, 73);
  assert.deepEqual(sent, [{
    chatId: '9001',
    invoice: {
      title: 'Starter',
      description: 'Starter credits',
      payload: 'stars:invoice-1',
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: 'Starter', amount: 73 }],
      start_parameter: 'buy_starter'
    }
  }]);
});

test('Stars invoice persists a first-time buyer and marks an unsent order failed', async (t) => {
  const products = productFromEnvironment(t);
  const events = [];
  const bot = createBot({
    config: { starsProducts: products },
    db: {
      async upsertUser(user) { events.push(['user', String(user.id)]); },
      createStarOrder(input) {
        events.push(['order', input.userId]);
        return { id: 'failed-order', invoicePayload: 'stars:failed-order' };
      },
      markStarOrderFailed(orderId) { events.push(['failed', orderId]); }
    }
  });

  await assert.rejects(() => bot.sendStarsInvoice({
    from: { id: 9002 },
    telegram: { async sendInvoice() { throw new Error('Telegram unavailable'); } },
    reply: async () => undefined
  }, 'starter'), /Telegram unavailable/);

  assert.deepEqual(events, [
    ['user', '9002'],
    ['order', '9002'],
    ['failed', 'failed-order']
  ]);
});

test('Stars pre-checkout always answers both accepted and rejected invoices', async () => {
  const accepted = [];
  const acceptedBot = createBot({
    db: {
      validateStarOrderForCheckout(input) {
        assert.deepEqual(input, {
          invoicePayload: 'stars:ok',
          userId: '31',
          currency: 'XTR',
          totalAmount: 12
        });
        return { ok: true };
      }
    }
  });
  await acceptedBot.handleStarsPreCheckout({
    from: { id: 31 },
    preCheckoutQuery: { invoice_payload: 'stars:ok', currency: 'XTR', total_amount: 12, from: { id: 31 } },
    answerPreCheckoutQuery: async (...args) => accepted.push(args)
  });
  assert.deepEqual(accepted, [[true]]);

  const rejected = [];
  const rejectedBot = createBot({
    db: {
      validateStarOrderForCheckout() {
        return { ok: false, reason: 'ORDER_EXPIRED' };
      }
    }
  });
  await rejectedBot.handleStarsPreCheckout({
    from: { id: 32 },
    preCheckoutQuery: { invoice_payload: 'stars:expired', currency: 'XTR', total_amount: 12, from: { id: 32 } },
    answerPreCheckoutQuery: async (...args) => rejected.push(args)
  });
  assert.deepEqual(rejected, [[false, 'ORDER_EXPIRED']]);
});

test('successful Stars payments call the database and do not grant credits twice', async () => {
  const calls = [];
  const replies = [];
  let writes = 0;
  const bot = createBot({
    db: {
      applySuccessfulStarPayment(input) {
        calls.push(input);
        return calls.length === 1 ? { credited: true } : { credited: false, duplicate: true };
      },
      async write() { writes += 1; }
    }
  });
  const ctx = {
    from: { id: 44 },
    message: {
      successful_payment: {
        invoice_payload: 'stars:payment-44',
        currency: 'XTR',
        total_amount: 73,
        telegram_payment_charge_id: 'tg-charge-44',
        provider_payment_charge_id: ''
      }
    },
    reply: async (text, extra) => replies.push({ text, extra })
  };

  await bot.handleStarsSuccessfulPayment(ctx);
  await bot.handleStarsSuccessfulPayment(ctx);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    invoicePayload: 'stars:payment-44',
    userId: '44',
    currency: 'XTR',
    totalAmount: 73,
    telegramPaymentChargeId: 'tg-charge-44',
    providerPaymentChargeId: ''
  });
  assert.equal(writes, 0, 'the atomic payment transaction must not depend on a redundant follow-up write');
  assert.match(replies[0].text, /credits were added/i);
  assert.match(replies[1].text, /already processed/i);
  assert.equal(replies.length, 2);
});

test('insufficient credits reply with purchase and balance buttons', async () => {
  const replies = [];
  const bot = createBot({
    db: {
      reserveUsage() {
        return { allowed: false, reason: 'INSUFFICIENT_CREDITS' };
      },
      async write() {}
    }
  });
  const allowed = await bot.consumeQuotaForContext({
    from: { id: 55 },
    chat: { id: 55 },
    update: { update_id: 555 },
    reply: async (text, extra) => replies.push({ text, extra })
  }, 'image_generation');

  assert.equal(allowed, false);
  assert.equal(replies.length, 1);
  const callbacks = replies[0].extra.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.deepEqual(callbacks, ['billing:store', 'billing:balance']);
});

test('administrator usage reservations are marked free and do not consume a paid balance', async () => {
  const seen = [];
  let paidBalance = 9;
  const bot = createBot({
    config: { adminUserIds: new Set(['66']) },
    db: {
      reserveUsage(input) {
        seen.push(input);
        assert.equal(input.isAdmin, true);
        assert.equal(paidBalance, 9, 'the billing backend must be told this is a free admin request');
        return {
          allowed: true,
          record: { id: 'admin-usage-1', requestKey: input.requestKey, source: 'admin' }
        };
      },
      commitUsage() { return { committed: true }; },
      async write() {}
    }
  });

  const reservation = await bot.reserveUsageForUser(66, 'video', { requestKey: 'admin-video-1' });

  assert.equal(reservation.allowed, true);
  assert.equal(reservation.admin, true);
  assert.equal(seen.length, 1);
  assert.equal(paidBalance, 9);
});

test('usage stays reserved until delivery commits it and failure restores it', async () => {
  const events = [];
  const bot = createBot({
    db: {
      reserveUsage(input) {
        events.push(['reserve', input.requestKey]);
        return {
          allowed: true,
          record: { id: 'usage-1', requestKey: input.requestKey, source: 'paid', status: 'reserved' }
        };
      },
      commitUsage(id) {
        events.push(['commit', id]);
        return { committed: true };
      },
      refundUsage(id) {
        events.push(['refund', id]);
        return { refunded: true };
      }
    }
  });

  const committed = await bot.reserveUsageForUser(77, 'chat', { requestKey: 'delivery:success' });
  assert.deepEqual(events, [['reserve', 'delivery:success']]);
  await bot.commitUsageReservation(committed);
  assert.deepEqual(events, [['reserve', 'delivery:success'], ['commit', 'usage-1']]);

  const failed = await bot.reserveUsageForUser(77, 'chat', { requestKey: 'delivery:failure' });
  await bot.refundUsageReservation(failed);
  assert.deepEqual(events.at(-1), ['refund', 'usage-1']);
});

test('admin refund uses Telegram refundStarPayment with the original charge and payer', async () => {
  const apiCalls = [];
  const completed = [];
  const bot = createBot({
    isAdmin: () => true,
    bot: {
      telegram: {
        async callApi(method, payload) {
          apiCalls.push({ method, payload });
        }
      }
    },
    db: {
      findStarOrderByChargeId(chargeId) {
        assert.equal(chargeId, 'tg-charge-refund');
        return { userId: '700' };
      },
      beginStarRefund(input) {
        assert.equal(input.telegramPaymentChargeId, 'tg-charge-refund');
        return { allowed: true, id: 'refund-700', leaseToken: 'lease-700' };
      },
      completeStarRefund(id, leaseToken) {
        completed.push([id, leaseToken]);
        return { completed: true };
      },
      async write() {}
    }
  });
  const replies = [];
  await bot.handleStarsRefund({
    from: { id: 66 },
    message: { text: '/refundstars tg-charge-refund' },
    reply: async (text) => replies.push(text)
  });

  assert.deepEqual(apiCalls, [{
    method: 'refundStarPayment',
    payload: { user_id: 700, telegram_payment_charge_id: 'tg-charge-refund' }
  }]);
  assert.deepEqual(completed, [['refund-700', 'lease-700']]);
  assert.equal(replies.length, 1);
});

test('an accepted Telegram refund never restores credits when local completion needs reconciliation', async () => {
  let failedLocally = 0;
  const apiCalls = [];
  const replies = [];
  const bot = createBot({
    isAdmin: () => true,
    bot: {
      telegram: {
        async callApi(method, payload) { apiCalls.push({ method, payload }); }
      }
    },
    db: {
      findStarOrderByChargeId() { return { userId: '701' }; },
      beginStarRefund() { return { allowed: true, id: 'refund-701', reason: 'REFUND_PENDING' }; },
      completeStarRefund() { throw new Error('injected local completion failure'); },
      failStarRefund() { failedLocally += 1; }
    }
  });

  await bot.handleStarsRefund({
    from: { id: 66 },
    message: { text: '/refundstars tg-charge-reconcile' },
    reply: async (text) => replies.push(text)
  });

  assert.equal(apiCalls.length, 1);
  assert.equal(failedLocally, 0, 'credits must stay frozen after Telegram accepted the refund');
  assert.match(replies[0], /local status synchronization failed/i);
});

test('a completed Stars refund returns locally without calling Telegram twice', async () => {
  let apiCalls = 0;
  const replies = [];
  const bot = createBot({
    isAdmin: () => true,
    bot: { telegram: { async callApi() { apiCalls += 1; } } },
    db: {
      findStarOrderByChargeId() { return { userId: '702' }; },
      beginStarRefund() {
        return { allowed: true, duplicate: true, reason: 'REFUND_ALREADY_COMPLETED' };
      }
    }
  });

  await bot.handleStarsRefund({
    from: { id: 66 },
    message: { text: '/refundstars tg-charge-done' },
    reply: async (text) => replies.push(text)
  });

  assert.equal(apiCalls, 0);
  assert.match(replies[0], /already been refunded/i);
});

test('an active refund lease suppresses a second Telegram refund request', async () => {
  let apiCalls = 0;
  const replies = [];
  const bot = createBot({
    isAdmin: () => true,
    bot: { telegram: { async callApi() { apiCalls += 1; } } },
    db: {
      findStarOrderByChargeId() { return { userId: '704' }; },
      beginStarRefund() {
        return { allowed: false, duplicate: true, inProgress: true, reason: 'REFUND_IN_PROGRESS' };
      }
    }
  });

  await bot.handleStarsRefund({
    from: { id: 66 },
    message: { text: '/refundstars tg-charge-active' },
    reply: async (text) => replies.push(text)
  });

  assert.equal(apiCalls, 0);
  assert.match(replies[0], /already in progress/i);
});

test('a timed-out refund remains pending instead of restoring possibly refunded credits', async () => {
  let failedLocally = 0;
  const replies = [];
  const bot = createBot({
    isAdmin: () => true,
    bot: { telegram: { async callApi() { throw new Error('network timeout'); } } },
    db: {
      findStarOrderByChargeId() { return { userId: '703' }; },
      beginStarRefund() { return { allowed: true, id: 'refund-703', reason: 'REFUND_PENDING' }; },
      failStarRefund() { failedLocally += 1; }
    }
  });
  bot.isAiTransientError = TelegramAIBot.prototype.isAiTransientError;

  await bot.handleStarsRefund({
    from: { id: 66 },
    message: { text: '/refundstars tg-charge-timeout' },
    reply: async (text) => replies.push(text)
  });

  assert.equal(failedLocally, 0);
  assert.match(replies[0], /outcome is temporarily unknown/i);
});

test('Stars package callbacks guide group users to private chat and report invoice failures', async () => {
  const groupReplies = [];
  let groupInvoiceCalls = 0;
  const groupBot = createBot();
  groupBot.botUsername = 'billing_bot';
  groupBot.sendStarsInvoice = async () => { groupInvoiceCalls += 1; };

  await groupBot.handleStarsProductCallback({
    match: ['stars_pkg:starter', 'starter'],
    chat: { id: -1001, type: 'group' },
    from: { id: 88 },
    answerCbQuery: async () => undefined,
    reply: async (text, extra) => groupReplies.push({ text, extra })
  });

  assert.equal(groupInvoiceCalls, 0);
  assert.match(groupReplies[0].text, /private chat/i);
  assert.equal(groupReplies[0].extra.reply_markup.inline_keyboard[0][0].url, 'https://t.me/billing_bot?start=buy');

  const privateReplies = [];
  const privateBot = createBot({ config: { starsProducts: [] } });
  privateBot.sendStarsInvoice = async () => { throw new Error('Telegram invoice unavailable'); };
  await privateBot.handleStarsProductCallback({
    match: ['stars_pkg:starter', 'starter'],
    chat: { id: 88, type: 'private' },
    from: { id: 88 },
    answerCbQuery: async () => undefined,
    reply: async (text, extra) => privateReplies.push({ text, extra })
  });

  assert.match(privateReplies[0].text, /could not be created/i);
  assert.ok(privateReplies[0].extra.reply_markup.inline_keyboard.length > 0);
});
