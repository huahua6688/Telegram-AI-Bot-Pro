import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeAdminUser } from '../src/services/admin-user-serializer.js';

const CREDIT_TYPES = ['chat', 'vision', 'image_generation', 'tts', 'live_voice', 'video'];

test('admin user serialization reads balances once and never reads per-credit daily usage', () => {
  let balanceReads = 0;
  let dailyUsageReads = 0;
  const db = {
    getUserAISettings() { return { providerId: 'gemini', modelId: 'gemini-test' }; },
    getUserDailyQuota() { return { dailyQuota: 20, dailyQuotaOverride: null, usesGlobalQuota: true }; },
    getUserCreditBalances() {
      balanceReads += 1;
      return {
        balances: {
          chat: { balance: 10 },
          vision: 2,
          image_generation: { balance: 3 },
          tts: -1,
          live_voice: Number.MAX_SAFE_INTEGER,
          video: '4'
        }
      };
    },
    getDailyCreditUsage() {
      dailyUsageReads += 1;
      return { used: 99 };
    }
  };

  const result = serializeAdminUser(db, {
    id: 42,
    username: 'alice',
    firstName: 'Alice',
    isAllowed: true
  }, {
    dailyQuota: 20,
    starsFreeQuota: { chat: 20 }
  });

  assert.equal(balanceReads, 1);
  assert.equal(dailyUsageReads, 0);
  assert.deepEqual(Object.keys(result.creditBalances), CREDIT_TYPES);
  assert.deepEqual(result.creditBalances, {
    chat: 10,
    vision: 2,
    image_generation: 3,
    tts: 0,
    live_voice: Number.MAX_SAFE_INTEGER,
    video: 4
  });
  assert.equal(result.billing, undefined);
  assert.equal(result.aiProvider, 'gemini');
});

test('legacy getCreditBalances remains supported', () => {
  let reads = 0;
  const result = serializeAdminUser({
    getUserAISettings() { return {}; },
    getCreditBalances() {
      reads += 1;
      return { chat: 7 };
    }
  }, { id: '55' }, { dailyQuota: 5 });

  assert.equal(reads, 1);
  assert.equal(result.creditBalances.chat, 7);
  assert.equal(result.creditBalances.vision, 0);
});


test('admin user serialization accepts health-server options object', () => {
  const db = {
    getUserAISettings() {
      return {};
    },
    getUserDailyQuota() {
      return {
        dailyQuota: 10,
        dailyQuotaOverride: null,
        usesGlobalQuota: true
      };
    },
    getUserCreditBalances() {
      return {
        balances: {
          chat: { balance: 8 }
        }
      };
    }
  };

  const result = serializeAdminUser({
    db,
    user: {
      id: '99',
      username: 'test-user',
      isAllowed: true
    },
    config: {
      dailyQuota: 10
    }
  });

  assert.equal(result.id, '99');
  assert.equal(result.username, 'test-user');
  assert.equal(result.creditBalances.chat, 8);
  assert.equal(result.billing, undefined);
});
