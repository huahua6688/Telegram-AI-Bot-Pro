import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BILLING_CREDIT_TYPES, BotDatabase } from '../src/db.js';

async function createTestDatabase(t, prefix = 'telegram-ai-bot-pro-stars-db-') {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const databaseFile = path.join(tempDir, 'bot-data.db');
  const databases = [];
  t.after(async () => {
    for (const database of databases) database.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const open = async () => {
    const database = new BotDatabase(databaseFile);
    databases.push(database);
    await database.init();
    return database;
  };

  return { databaseFile, open };
}

test('Stars payments credit each capability exactly once and persist charge IDs', async (t) => {
  const fixture = await createTestDatabase(t);
  const db = await fixture.open();
  await db.upsertUser({ id: 101, username: 'buyer', first_name: 'Buyer', language_code: 'en' });

  assert.deepEqual(BILLING_CREDIT_TYPES, [
    'chat',
    'vision',
    'image_generation',
    'tts',
    'live_voice',
    'video'
  ]);

  const order = db.createStarOrder({
    userId: 101,
    productId: 'starter',
    amount: 75,
    grants: {
      chat: 20,
      vision: 5,
      image_generation: 3,
      tts: 4,
      live_voice: 2,
      video: 1
    },
    expiresAt: '2099-01-01T00:00:00.000Z'
  });

  assert.equal(order.currency, 'XTR');
  assert.match(order.invoicePayload, /^stars:/);
  assert.deepEqual(
    db.validateStarOrderForCheckout({
      invoicePayload: order.invoicePayload,
      userId: 101,
      currency: 'XTR',
      totalAmount: 75,
      at: '2026-01-01T00:00:00.000Z'
    }),
    { ok: true, code: 'OK', order }
  );
  assert.equal(
    db.validateStarOrderForCheckout({
      invoicePayload: order.invoicePayload,
      userId: 999,
      currency: 'XTR',
      totalAmount: 75
    }).code,
    'ORDER_USER_MISMATCH'
  );

  const mismatched = db.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 101,
    currency: 'XTR',
    totalAmount: 74,
    telegramPaymentChargeId: 'charge-wrong-amount'
  });
  assert.equal(mismatched.credited, false);
  assert.equal(mismatched.reason, 'ORDER_AMOUNT_MISMATCH');
  assert.equal(db.getCreditBalance(101, 'chat').balance, 0);

  const paid = db.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 101,
    currency: 'XTR',
    totalAmount: 75,
    telegramPaymentChargeId: 'tg-charge-101',
    providerPaymentChargeId: 'provider-empty-is-allowed'
  });
  assert.equal(paid.credited, true);
  assert.equal(paid.order.telegramPaymentChargeId, 'tg-charge-101');
  assert.deepEqual(paid.balances.balances, order.grants);

  const duplicate = db.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 101,
    currency: 'XTR',
    totalAmount: 75,
    telegramPaymentChargeId: 'tg-charge-101'
  });
  assert.equal(duplicate.credited, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reason, 'PAYMENT_ALREADY_APPLIED');
  assert.deepEqual(duplicate.balances.balances, order.grants);

  const secondChargeForSameOrder = db.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 101,
    currency: 'XTR',
    totalAmount: 75,
    telegramPaymentChargeId: 'tg-charge-101-second'
  });
  assert.equal(secondChargeForSameOrder.credited, false);
  assert.equal(secondChargeForSameOrder.reason, 'ORDER_NOT_PENDING');
  assert.deepEqual(db.getUserCreditBalances(101).balances, order.grants);

  const otherOrder = db.createStarOrder({
    userId: 101,
    productId: 'other-pack',
    amount: 10,
    grants: { chat: 1 }
  });
  const reusedCharge = db.applySuccessfulStarPayment({
    invoicePayload: otherOrder.invoicePayload,
    userId: 101,
    currency: 'XTR',
    totalAmount: 10,
    telegramPaymentChargeId: 'tg-charge-101'
  });
  assert.equal(reusedCharge.credited, false);
  assert.equal(reusedCharge.duplicate, false);
  assert.equal(reusedCharge.reason, 'PAYMENT_CHARGE_CONFLICT');
  assert.equal(db.getStarOrder(otherOrder.id).status, 'pending');

  db.close();
  const reopened = await fixture.open();
  assert.equal(reopened.getMeta('schemaVersion'), '8');
  assert.equal(reopened.findStarOrderByChargeId('tg-charge-101')?.status, 'paid');
  assert.deepEqual(reopened.getCreditBalances(101).balances, order.grants);
});

test('usage reservations isolate free and paid capability balances and refund the exact source', async (t) => {
  const fixture = await createTestDatabase(t);
  const db = await fixture.open();
  await db.upsertUser({ id: 201, username: 'metered', first_name: 'Metered', language_code: 'en' });
  await db.upsertUser({ id: 202, username: 'admin', first_name: 'Admin', language_code: 'en' });

  const order = db.createStarOrder({
    userId: 201,
    productId: 'resource-pack',
    amount: 50,
    grants: { chat: 2, vision: 2, image: 1, tts: 1, voice: 1, video: 1 }
  });
  db.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 201,
    currency: 'XTR',
    totalAmount: 50,
    telegramPaymentChargeId: 'tg-charge-201'
  });

  const freeVision = db.reserveUsage({
    userId: 201,
    creditType: 'vision',
    requestKey: 'update:vision:1',
    dailyFreeQuota: 1,
    usageDate: '2026-07-21'
  });
  assert.equal(freeVision.allowed, true);
  assert.equal(freeVision.record.source, 'daily_free');
  assert.equal(freeVision.balance, 2);
  const pendingReplay = db.reserveUsage({
    userId: 201,
    creditType: 'vision',
    requestKey: 'update:vision:1',
    dailyFreeQuota: 1,
    usageDate: '2026-07-21'
  });
  assert.equal(pendingReplay.allowed, false);
  assert.equal(pendingReplay.duplicate, true);
  assert.equal(pendingReplay.inProgress, true);
  assert.equal(pendingReplay.reason, 'USAGE_ALREADY_RESERVED');
  assert.equal(db.getDailyCreditUsage(201, 'vision', '2026-07-21').used, 1);
  assert.equal(db.commitUsage(freeVision.record.id).committed, true);
  assert.equal(db.commitUsage(freeVision.record.id).duplicate, true);

  const duplicateReservation = db.reserveUsage({
    userId: 201,
    creditType: 'vision',
    requestKey: 'update:vision:1',
    dailyFreeQuota: 1,
    usageDate: '2026-07-21'
  });
  assert.equal(duplicateReservation.allowed, false);
  assert.equal(duplicateReservation.duplicate, true);
  assert.equal(duplicateReservation.completed, true);
  assert.equal(duplicateReservation.reason, 'USAGE_ALREADY_COMMITTED');
  assert.equal(duplicateReservation.record.status, 'consumed');
  assert.equal(db.getDailyCreditUsage(201, 'vision', '2026-07-21').used, 1);

  const paidVision = db.reserveUsage({
    userId: 201,
    creditType: 'vision',
    requestKey: 'update:vision:2',
    dailyFreeQuota: 1,
    usageDate: '2026-07-21'
  });
  assert.equal(paidVision.record.source, 'paid');
  assert.equal(db.getCreditBalance(201, 'vision').balance, 1);
  assert.equal(db.refundUsage(paidVision.record.id).refunded, true);
  assert.equal(db.getCreditBalance(201, 'vision').balance, 2);
  assert.equal(db.refundUsage(paidVision.record.id).duplicate, true);
  assert.equal(db.getCreditBalance(201, 'vision').balance, 2);

  db.setUserDailyQuota(201, 1, 10);
  const freeChat = db.reserveUsage({
    userId: 201,
    creditType: 'chat',
    requestKey: 'update:chat:1',
    dailyFreeQuota: 10
  });
  assert.equal(freeChat.record.source, 'daily_free');
  assert.equal(db.findUser(201).dailyUsageCount, 1);
  const paidChat = db.reserveUsage({
    userId: 201,
    creditType: 'chat',
    requestKey: 'update:chat:2',
    dailyFreeQuota: 10
  });
  assert.equal(paidChat.record.source, 'paid');
  assert.equal(db.getCreditBalance(201, 'chat').balance, 1);
  assert.equal(db.findUser(201).dailyUsageCount, 1);

  const freeImage = db.reserveUsage({
    userId: 201,
    creditType: 'image_generation',
    requestKey: 'update:image:1',
    dailyFreeQuota: 1,
    usageDate: '2026-07-21'
  });
  assert.equal(freeImage.record.source, 'daily_free');
  assert.equal(db.getCreditBalance(201, 'image_generation').balance, 1);
  assert.equal(db.getCreditBalance(201, 'vision').balance, 2);

  const admin = db.reserveUsage({
    userId: 202,
    creditType: 'video',
    requestKey: 'update:admin:video',
    dailyFreeQuota: 0,
    isAdmin: true
  });
  assert.equal(admin.allowed, true);
  assert.equal(admin.record.source, 'admin');
  assert.equal(admin.balance, 0);
  assert.equal(db.getDailyCreditUsage(202, 'video').used, 0);
  assert.equal(db.commitUsage(admin.record.requestKey).committed, true);

  const denied = db.reserveUsage({
    userId: 202,
    creditType: 'video',
    requestKey: 'update:user:video',
    dailyFreeQuota: 0,
    isAdmin: false
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'INSUFFICIENT_CREDITS');
  assert.equal(db.listUsageRecords({ userId: 201 }).length, 5);
});

test('stale usage reservations are restored without touching completed usage', async (t) => {
  const fixture = await createTestDatabase(t);
  const db = await fixture.open();
  await db.upsertUser({ id: 250, username: 'recovery', first_name: 'Recovery', language_code: 'en' });

  const order = db.createStarOrder({
    userId: 250,
    productId: 'recovery-pack',
    amount: 10,
    grants: { image_generation: 2 }
  });
  db.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 250,
    currency: 'XTR',
    totalAmount: 10,
    telegramPaymentChargeId: 'tg-recovery-250'
  });

  const stale = db.reserveUsage({
    userId: 250,
    creditType: 'image_generation',
    requestKey: 'recovery:stale',
    dailyFreeQuota: 0
  });
  const completed = db.reserveUsage({
    userId: 250,
    creditType: 'image_generation',
    requestKey: 'recovery:completed',
    dailyFreeQuota: 0
  });
  db.commitUsage(completed.record.id);
  assert.equal(db.getCreditBalance(250, 'image_generation').balance, 0);

  const committedRefund = db.refundUsage(completed.record.id);
  assert.equal(committedRefund.refunded, false);
  assert.equal(committedRefund.duplicate, false);
  assert.equal(committedRefund.reason, 'USAGE_ALREADY_COMMITTED');
  assert.equal(db.getUsageRecord(completed.record.id).status, 'consumed');
  assert.equal(db.getCreditBalance(250, 'image_generation').balance, 0);

  db.db.prepare("UPDATE usage_records SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id IN (?, ?)")
    .run(stale.record.id, completed.record.id);
  const recovered = db.refundStaleUsageReservations({ olderThanMs: 60_000 });

  assert.equal(recovered.refunded, 1);
  assert.equal(db.getUsageRecord(stale.record.id).status, 'refunded');
  assert.equal(db.getUsageRecord(completed.record.id).status, 'consumed');
  assert.equal(db.getCreditBalance(250, 'image_generation').balance, 1);
});

test('Stars refunds reserve grants, compensate failures, and complete idempotently', async (t) => {
  const fixture = await createTestDatabase(t);
  const db = await fixture.open();
  await db.upsertUser({ id: 301, username: 'refund-user', first_name: 'Refund', language_code: 'en' });

  const order = db.createStarOrder({
    userId: 301,
    productId: 'refundable',
    amount: 30,
    grants: { chat: 3, tts: 1 }
  });
  db.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 301,
    currency: 'XTR',
    totalAmount: 30,
    telegramPaymentChargeId: 'tg-refund-301'
  });

  const pending = db.beginStarRefund({
    telegramPaymentChargeId: 'tg-refund-301',
    requestedBy: 'admin-1',
    reason: 'customer request'
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.allowed, true);
  assert.equal(pending.id, pending.refund.id);
  assert.ok(pending.leaseToken);
  assert.equal(pending.refund.leaseToken, pending.leaseToken);
  assert.ok(pending.refund.leaseExpiresAt);
  assert.equal(pending.refund.status, 'pending');
  assert.equal(pending.order.status, 'refund_pending');
  assert.equal(db.getCreditBalance(301, 'chat').balance, 0);
  assert.equal(db.getCreditBalance(301, 'tts').balance, 0);
  const concurrent = db.beginStarRefund({ telegramPaymentChargeId: 'tg-refund-301' });
  assert.equal(concurrent.allowed, false);
  assert.equal(concurrent.duplicate, true);
  assert.equal(concurrent.inProgress, true);
  assert.equal(concurrent.reason, 'REFUND_IN_PROGRESS');
  assert.equal(db.getCreditBalance(301, 'chat').balance, 0);

  const failed = db.failStarRefund(
    'tg-refund-301',
    'Telegram temporarily unavailable',
    pending.leaseToken
  );
  assert.equal(failed.failed, true);
  assert.equal(failed.order.status, 'paid');
  assert.equal(failed.refund.status, 'failed');
  assert.equal(db.getCreditBalance(301, 'chat').balance, 3);
  assert.equal(db.getCreditBalance(301, 'tts').balance, 1);
  assert.equal(db.failStarRefund('tg-refund-301', 'duplicate').duplicate, true);
  assert.equal(db.getCreditBalance(301, 'chat').balance, 3);

  const retried = db.beginStarRefund({ telegramPaymentChargeId: 'tg-refund-301', requestedBy: 'admin-1' });
  assert.equal(retried.ok, true);
  assert.equal(retried.duplicate, false);
  assert.ok(retried.leaseToken);
  assert.notEqual(retried.leaseToken, pending.leaseToken);
  assert.equal(db.getCreditBalance(301, 'chat').balance, 0);

  const completed = db.completeStarRefund(retried.refund.id, retried.leaseToken);
  assert.equal(completed.completed, true);
  assert.equal(completed.order.status, 'refunded');
  assert.ok(completed.order.refundedAt);
  assert.equal(db.completeStarRefund('tg-refund-301').duplicate, true);
  assert.equal(db.beginStarRefund({ telegramPaymentChargeId: 'tg-refund-301' }).duplicate, true);

  const paymentReplay = db.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 301,
    currency: 'XTR',
    totalAmount: 30,
    telegramPaymentChargeId: 'tg-refund-301'
  });
  assert.equal(paymentReplay.duplicate, true);
  assert.equal(db.getCreditBalance(301, 'chat').balance, 0);

  const usedOrder = db.createStarOrder({
    userId: 301,
    productId: 'partly-used',
    amount: 20,
    grants: { chat: 2 }
  });
  db.applySuccessfulStarPayment({
    invoicePayload: usedOrder.invoicePayload,
    userId: 301,
    currency: 'XTR',
    totalAmount: 20,
    telegramPaymentChargeId: 'tg-refund-used-301'
  });
  const consumed = db.reserveUsage({
    userId: 301,
    creditType: 'chat',
    requestKey: 'refund-test:consumed-chat',
    dailyFreeQuota: 0
  });
  assert.equal(consumed.record.source, 'paid');
  db.commitUsage(consumed.record.id);
  const ineligible = db.beginStarRefund({ telegramPaymentChargeId: 'tg-refund-used-301' });
  assert.equal(ineligible.ok, false);
  assert.equal(ineligible.allowed, false);
  assert.equal(ineligible.reason, 'ORDER_CREDITS_ALREADY_USED');
  assert.equal(db.findStarOrderByChargeId('tg-refund-used-301').status, 'paid');
});

test('Stars refund leases reject concurrent owners and stale tokens after takeover', async (t) => {
  const fixture = await createTestDatabase(t, 'telegram-ai-bot-pro-refund-lease-');
  const ownerDb = await fixture.open();
  const contenderDb = await fixture.open();
  await ownerDb.upsertUser({ id: 302, username: 'lease-user', first_name: 'Lease', language_code: 'en' });

  const order = ownerDb.createStarOrder({
    userId: 302,
    productId: 'lease-pack',
    amount: 15,
    grants: { chat: 2, live_voice: 1 }
  });
  ownerDb.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 302,
    currency: 'XTR',
    totalAmount: 15,
    telegramPaymentChargeId: 'tg-refund-lease-302'
  });

  const first = ownerDb.beginStarRefund({
    telegramPaymentChargeId: 'tg-refund-lease-302',
    requestedBy: 'worker-a',
    leaseDurationMs: 60_000,
    at: '2026-07-21T00:00:00.000Z'
  });
  assert.equal(first.allowed, true);
  assert.equal(first.reason, 'REFUND_PENDING');
  assert.equal(ownerDb.getCreditBalance(302, 'chat').balance, 0);

  const activeLease = contenderDb.beginStarRefund({
    telegramPaymentChargeId: 'tg-refund-lease-302',
    requestedBy: 'worker-b',
    leaseDurationMs: 60_000,
    at: '2026-07-21T00:00:30.000Z'
  });
  assert.equal(activeLease.allowed, false);
  assert.equal(activeLease.inProgress, true);
  assert.equal(activeLease.reason, 'REFUND_IN_PROGRESS');
  assert.equal(activeLease.refund.leaseToken, first.leaseToken);

  const takeover = contenderDb.beginStarRefund({
    telegramPaymentChargeId: 'tg-refund-lease-302',
    requestedBy: 'worker-b',
    leaseDurationMs: 60_000,
    at: '2026-07-21T00:01:01.000Z'
  });
  assert.equal(takeover.allowed, true);
  assert.equal(takeover.duplicate, true);
  assert.equal(takeover.reason, 'REFUND_RETRY_PENDING');
  assert.notEqual(takeover.leaseToken, first.leaseToken);
  assert.equal(takeover.refund.requestedBy, 'worker-b');
  assert.equal(ownerDb.getCreditBalance(302, 'chat').balance, 0);

  const staleComplete = ownerDb.completeStarRefund(first.id, first.leaseToken);
  assert.equal(staleComplete.completed, false);
  assert.equal(staleComplete.reason, 'REFUND_LEASE_MISMATCH');
  const staleFail = ownerDb.failStarRefund(first.id, 'late failure from worker-a', first.leaseToken);
  assert.equal(staleFail.failed, false);
  assert.equal(staleFail.reason, 'REFUND_LEASE_MISMATCH');
  assert.equal(ownerDb.getStarRefund(first.id).status, 'pending');
  assert.equal(ownerDb.getCreditBalance(302, 'chat').balance, 0);

  const completed = contenderDb.completeStarRefund(takeover.id, takeover.leaseToken);
  assert.equal(completed.completed, true);
  assert.equal(completed.order.status, 'refunded');
  assert.equal(completed.refund.leaseToken, '');
  assert.equal(completed.refund.leaseExpiresAt, '');
  assert.equal(ownerDb.getCreditBalance(302, 'chat').balance, 0);
});

test('administrator balance updates atomically set and adjust all paid credit types with audit history', async (t) => {
  const fixture = await createTestDatabase(t, 'telegram-ai-bot-pro-admin-credits-');
  const db = await fixture.open();
  await db.upsertUser({ id: 351, username: 'managed', first_name: 'Managed', language_code: 'en' });

  const freeVision = db.reserveUsage({
    userId: 351,
    creditType: 'vision',
    requestKey: 'admin-credit-test:free-vision',
    dailyFreeQuota: 5,
    usageDate: '2026-07-21'
  });
  db.commitUsage(freeVision.record.id);
  assert.equal(db.getDailyCreditUsage(351, 'vision', '2026-07-21').used, 1);

  const initial = {
    chat: 10,
    vision: 2,
    image_generation: 3,
    tts: 4,
    live_voice: 5,
    video: 6
  };
  const setResult = db.setUserCreditBalances(351, initial, {
    requireAll: true,
    audit: {
      actorId: 'admin-9001',
      actorType: 'telegram_miniapp',
      action: 'users.credits.set',
      requestId: 'set-six-balances'
    }
  });
  assert.deepEqual(setResult.balances, initial);
  assert.deepEqual(db.getUserCreditBalances(351).balances, initial);

  const adjusted = db.adjustUserCreditBalances(351, { chat: -4, vision: 3, video: 0 }, {
    audit: {
      actorId: 'admin-9001',
      actorType: 'telegram_miniapp',
      action: 'users.credits.adjust',
      requestId: 'adjust-three-balances'
    }
  });
  assert.deepEqual(adjusted.balances, {
    chat: 6,
    vision: 5,
    image_generation: 3,
    tts: 4,
    live_voice: 5,
    video: 6
  });
  assert.deepEqual(adjusted.changes, {
    chat: { before: 10, after: 6, delta: -4 },
    vision: { before: 2, after: 5, delta: 3 }
  });

  const beforeRejectedUpdate = db.getUserCreditBalances(351).balances;
  assert.throws(
    () => db.adjustUserCreditBalances(351, { chat: -7, tts: 100 }),
    (error) => error?.code === 'CREDIT_BALANCE_BELOW_ZERO'
  );
  assert.deepEqual(db.getUserCreditBalances(351).balances, beforeRejectedUpdate);
  assert.throws(
    () => db.setUserCreditBalances(351, { chat: 99 }, { requireAll: true }),
    (error) => error?.code === 'INCOMPLETE_CREDIT_BALANCES'
  );
  assert.deepEqual(db.getUserCreditBalances(351).balances, beforeRejectedUpdate);
  assert.equal(
    db.getDailyCreditUsage(351, 'vision', '2026-07-21').used,
    1,
    'paid balance administration must not alter daily free usage'
  );

  const setAudit = db.listAuditLogs({ action: 'users.credits.set' })[0];
  assert.equal(setAudit.actorId, 'admin-9001');
  assert.equal(setAudit.targetId, '351');
  assert.deepEqual(setAudit.details.beforeBalances, {
    chat: 0,
    vision: 0,
    image_generation: 0,
    tts: 0,
    live_voice: 0,
    video: 0
  });
  assert.deepEqual(setAudit.details.afterBalances, initial);

  const adjustAudit = db.listAuditLogs({ action: 'users.credits.adjust' })[0];
  assert.deepEqual(adjustAudit.details.changes, adjusted.changes);
});

test('v6 databases migrate to Stars schema without changing legacy daily quota behavior', async (t) => {
  const fixture = await createTestDatabase(t, 'telegram-ai-bot-pro-stars-migration-');
  const db = await fixture.open();
  await db.upsertUser({ id: 401, username: 'legacy', first_name: 'Legacy', language_code: 'en' });
  db.setUserDailyQuota(401, 2, 10);
  db.setUserDailyUsage(401, 1);

  db.db.exec(`
    DROP TABLE star_refunds;
    DROP TABLE usage_records;
    DROP TABLE daily_credit_usage;
    DROP TABLE user_credit_balances;
    DROP TABLE star_orders;
  `);
  db.setMeta('schemaVersion', '6');
  db.close();

  const upgraded = await fixture.open();
  assert.equal(upgraded.getMeta('schemaVersion'), '8');
  assert.equal(upgraded.getUserDailyQuota(401, 10).dailyQuota, 2);
  assert.equal(upgraded.findUser(401).dailyUsageCount, 1);
  assert.deepEqual(upgraded.consumeDailyQuota(401, 10), {
    allowed: true,
    remaining: 0,
    quota: 2,
    dailyQuotaOverride: 2
  });
  assert.equal(upgraded.getDailyCreditUsage(401, 'chat').used, 2);

  const tables = upgraded.db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'star_orders', 'user_credit_balances', 'daily_credit_usage', 'usage_records', 'star_refunds'
       )
       ORDER BY name`
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, [
    'daily_credit_usage',
    'star_orders',
    'star_refunds',
    'usage_records',
    'user_credit_balances'
  ]);
});

test('v7 Stars refund rows gain lease columns during the v8 migration', async (t) => {
  const fixture = await createTestDatabase(t, 'telegram-ai-bot-pro-refund-v8-migration-');
  const db = await fixture.open();
  await db.upsertUser({ id: 402, username: 'v7-refund', first_name: 'Legacy Refund', language_code: 'en' });
  const order = db.createStarOrder({
    userId: 402,
    productId: 'legacy-refund-pack',
    amount: 12,
    grants: { chat: 2 }
  });
  db.applySuccessfulStarPayment({
    invoicePayload: order.invoicePayload,
    userId: 402,
    currency: 'XTR',
    totalAmount: 12,
    telegramPaymentChargeId: 'tg-refund-v7-402'
  });
  const pending = db.beginStarRefund({
    telegramPaymentChargeId: 'tg-refund-v7-402',
    requestedBy: 'legacy-worker'
  });
  db.db.exec(`
    DROP TABLE star_refunds;
    CREATE TABLE star_refunds (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      telegram_payment_charge_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'succeeded', 'failed')),
      requested_by TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      revoked_grants_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(order_id) REFERENCES star_orders(id) ON DELETE RESTRICT
    );
    CREATE INDEX idx_star_refunds_status_updated
      ON star_refunds(status, updated_at DESC);
  `);
  db.db
    .prepare(
      `INSERT INTO star_refunds(
         id, order_id, telegram_payment_charge_id, status, requested_by, reason,
         error, revoked_grants_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'pending', ?, ?, '', ?, ?, ?)`
    )
    .run(
      pending.id,
      order.id,
      'tg-refund-v7-402',
      'legacy-worker',
      'legacy pending refund',
      JSON.stringify({ chat: 2 }),
      pending.refund.createdAt,
      pending.refund.updatedAt
    );
  db.setMeta('schemaVersion', '7');
  db.close();

  const upgraded = await fixture.open();
  assert.equal(upgraded.getMeta('schemaVersion'), '8');
  const columns = upgraded.db
    .prepare('PRAGMA table_info(star_refunds)')
    .all()
    .map((column) => column.name);
  assert.ok(columns.includes('lease_token'));
  assert.ok(columns.includes('lease_expires_at'));

  const migrated = upgraded.getStarRefund('tg-refund-v7-402');
  assert.equal(migrated.status, 'pending');
  assert.equal(migrated.leaseToken, '');
  assert.equal(migrated.leaseExpiresAt, '');
  const unclaimedCompletion = upgraded.completeStarRefund(migrated.id);
  assert.equal(unclaimedCompletion.completed, false);
  assert.equal(unclaimedCompletion.reason, 'REFUND_LEASE_MISMATCH');

  const claimed = upgraded.beginStarRefund({
    telegramPaymentChargeId: 'tg-refund-v7-402',
    requestedBy: 'v8-worker'
  });
  assert.equal(claimed.allowed, true);
  assert.equal(claimed.reason, 'REFUND_RETRY_PENDING');
  assert.ok(claimed.leaseToken);
  assert.equal(upgraded.completeStarRefund(claimed.id, claimed.leaseToken).completed, true);
});
