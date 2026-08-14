import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryableTelegramStartupError,
  retryTelegramStartupCall
} from '../src/utils/telegram-startup.js';

test('Telegram startup retries transient network errors and then succeeds', async () => {
  let calls = 0;
  const delays = [];
  const result = await retryTelegramStartupCall(async () => {
    calls += 1;
    if (calls < 3) {
      const error = new Error('getMe timed out');
      error.code = 'ETIMEDOUT';
      throw error;
    }
    return { id: 42 };
  }, {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    sleep: async (ms) => delays.push(ms)
  });
  assert.deepEqual(result, { id: 42 });
  assert.equal(calls, 3);
  assert.equal(delays.length, 2);
});

test('Telegram startup honors retry_after and does not retry invalid tokens', async () => {
  const delays = [];
  let rateCalls = 0;
  await retryTelegramStartupCall(async () => {
    rateCalls += 1;
    if (rateCalls === 1) {
      throw {
        message: 'Too Many Requests',
        response: { error_code: 429, parameters: { retry_after: 2 } }
      };
    }
    return true;
  }, {
    maxRetries: 1,
    baseDelayMs: 100,
    maxDelayMs: 3000,
    sleep: async (ms) => delays.push(ms)
  });
  assert.equal(delays[0], 2000);

  assert.equal(isRetryableTelegramStartupError({ response: { error_code: 401 } }), false);
  let authCalls = 0;
  await assert.rejects(
    retryTelegramStartupCall(async () => {
      authCalls += 1;
      throw { message: 'Unauthorized', response: { error_code: 401 } };
    }, { maxRetries: 5, sleep: async () => {} })
  );
  assert.equal(authCalls, 1);
});
