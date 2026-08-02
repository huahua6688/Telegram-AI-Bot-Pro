import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BILLING_CREDIT_TYPES,
  buildBillingCatalog,
  buildConfiguredFreeQuota,
  buildUserBillingSnapshot,
  getDefaultChatFreeQuota,
  resolveUserFreeQuota
} from '../src/services/billing-catalog.js';

const FREE_QUOTA = {
  chat: 20,
  vision: 3,
  image_generation: 1,
  tts: 2,
  live_voice: 2,
  video: 0
};

test('the billing catalog uses one normalized free-quota source with legacy chat fallback', () => {
  assert.deepEqual(buildConfiguredFreeQuota({ starsFreeQuota: FREE_QUOTA, dailyQuota: 999 }), FREE_QUOTA);
  assert.equal(getDefaultChatFreeQuota({ starsFreeQuota: FREE_QUOTA, dailyQuota: 999 }), 20);
  assert.deepEqual(buildConfiguredFreeQuota({ dailyQuota: 25 }), {
    chat: 25,
    vision: 0,
    image_generation: 0,
    tts: 0,
    live_voice: 0,
    video: 0
  });
});

test('the billing catalog preserves configured products and respects payment and video switches', () => {
  const catalog = buildBillingCatalog({
    starsPaymentsEnabled: false,
    enableVideo: false,
    starsFreeQuota: FREE_QUOTA,
    starsProducts: [{
      id: 'starter',
      title: '入门额度包',
      titleEn: 'Starter credits',
      description: '适合轻量使用',
      descriptionEn: 'Starter credits',
      price: 50,
      credits: {
        chat: 200,
        vision: 20,
        image_generation: 5,
        tts: 20,
        live_voice: 10,
        video: 0
      }
    }]
  });

  assert.equal(catalog.enabled, false);
  assert.equal(catalog.videoEnabled, false);
  assert.deepEqual(catalog.freeQuota, FREE_QUOTA);
  assert.deepEqual(catalog.products[0], {
    id: 'starter',
    title: '入门额度包',
    titleEn: 'Starter credits',
    description: '适合轻量使用',
    descriptionEn: 'Starter credits',
    price: 50,
    credits: {
      chat: 200,
      vision: 20,
      image_generation: 5,
      tts: 20,
      live_voice: 10,
      video: 0
    }
  });
});

test('per-user chat overrides and global zero-unlimited semantics resolve consistently', () => {
  const override = resolveUserFreeQuota({
    config: { starsFreeQuota: FREE_QUOTA },
    userId: '42',
    creditType: 'chat',
    db: {
      getUserDailyQuota() {
        return { dailyQuota: 0, dailyQuotaOverride: 0, usesGlobalQuota: false };
      }
    }
  });
  assert.deepEqual(override, { dailyFreeQuota: 0, unlimited: true });

  const global = resolveUserFreeQuota({
    config: {
      starsFreeQuota: { ...FREE_QUOTA, chat: 0 },
      starsFreeChatZeroMeansUnlimited: true
    },
    userId: '42',
    creditType: 'chat',
    db: {
      getUserDailyQuota() {
        return { dailyQuota: 0, dailyQuotaOverride: null, usesGlobalQuota: true };
      }
    }
  });
  assert.deepEqual(global, { dailyFreeQuota: 0, unlimited: true });
});

test('a user billing snapshot combines free use, purchased balances, admin access, and feature state', () => {
  const purchased = {
    chat: 11,
    vision: 12,
    image_generation: 13,
    tts: 14,
    live_voice: 15,
    video: 16
  };
  const used = {
    chat: 2,
    vision: 1,
    image_generation: 0,
    tts: 2,
    live_voice: 1,
    video: 0
  };
  const db = {
    getUserCreditBalances(userId) {
      assert.equal(userId, '42');
      return { userId, balances: purchased };
    },
    getUserDailyQuota(userId, defaultQuota) {
      assert.equal(userId, '42');
      assert.equal(defaultQuota, 20);
      return { dailyQuota: 7, dailyQuotaOverride: 7, usesGlobalQuota: false };
    },
    getDailyCreditUsage(userId, creditType) {
      assert.equal(userId, '42');
      return { used: used[creditType] };
    }
  };
  const config = {
    enableVideo: false,
    starsFreeQuota: FREE_QUOTA,
    starsProducts: []
  };

  const snapshot = buildUserBillingSnapshot({ db, config, userId: 42 });
  assert.deepEqual(Object.keys(snapshot.credits), BILLING_CREDIT_TYPES);
  assert.deepEqual(snapshot.credits.chat, {
    type: 'chat',
    enabled: true,
    unlimited: false,
    freeDaily: 7,
    freeUsed: 2,
    freeRemaining: 5,
    purchased: 11
  });
  assert.equal(snapshot.credits.vision.freeRemaining, 2);
  assert.equal(snapshot.credits.vision.purchased, 12);
  assert.equal(snapshot.credits.video.enabled, false);
  assert.equal(snapshot.credits.video.purchased, 16);

  const adminSnapshot = buildUserBillingSnapshot({ db, config, userId: 42, isAdmin: true });
  for (const type of BILLING_CREDIT_TYPES) {
    assert.equal(adminSnapshot.credits[type].unlimited, true);
    assert.equal(adminSnapshot.credits[type].freeRemaining, null);
  }
});
