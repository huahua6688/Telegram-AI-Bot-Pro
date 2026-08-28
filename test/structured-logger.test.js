import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructuredLogger } from '../src/core/observability/structured-logger.js';

test('structured logger redacts content and pseudonymizes Telegram identities', () => {
  const originalWarn = console.warn;
  const outputs = [];
  const fakeApiKey = `sk-${'x'.repeat(24)}`;
  console.warn = (value) => outputs.push(String(value));
  try {
    createStructuredLogger().warn('privacy test', {
      userId: '6288004141',
      chatId: '6288004141',
      username: 'private_name',
      prompt: 'private message body',
      apiKey: fakeApiKey,
      path: '/api/miniapp/admin/users?q=6288004141',
      provider: 'gemini',
      count: 2
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].includes(fakeApiKey), false);
  assert.doesNotMatch(outputs[0], /6288004141|private_name|private message body/);
  const payload = JSON.parse(outputs[0]);
  assert.match(payload.meta.userId, /^anon:[a-f0-9]{12}$/);
  assert.equal(payload.meta.userId, payload.meta.chatId);
  assert.equal(payload.meta.username, '[REDACTED]');
  assert.equal(payload.meta.prompt, '[REDACTED]');
  assert.equal(payload.meta.apiKey, '[REDACTED]');
  assert.equal(payload.meta.path, '/api/miniapp/admin/users');
  assert.equal(payload.meta.provider, 'gemini');
  assert.equal(payload.meta.count, 2);
});

test('structured logger keeps only safe error metadata and stays serializable', () => {
  const originalError = console.error;
  const outputs = [];
  console.error = (value) => outputs.push(String(value));
  const unsafeError = new Error('Bearer private-token with private message body');
  unsafeError.code = 'ETIMEDOUT';
  const meta = {
    error: unsafeError,
    detail: 'private provider response',
    ip: '203.0.113.20',
    sessionId: 'private-session',
    providerId: 'gemini',
    amount: 3n
  };
  meta.self = meta;
  try {
    createStructuredLogger().error('safe error', meta);
  } finally {
    console.error = originalError;
  }

  const payload = JSON.parse(outputs[0]);
  assert.equal(payload.meta.amount, '3');
  assert.deepEqual(payload.meta.error, { name: 'Error', code: 'ETIMEDOUT' });
  assert.equal(payload.meta.detail, '[REDACTED]');
  assert.equal(payload.meta.ip, '[REDACTED]');
  assert.match(payload.meta.sessionId, /^anon:[a-f0-9]{12}$/);
  assert.equal(payload.meta.providerId, 'gemini');
  assert.equal(payload.meta.self, '[TRUNCATED]');
  assert.doesNotMatch(outputs[0], /private-token|private message body|private provider response|203\.0\.113\.20|private-session/);
});

test('structured logger keeps pseudonyms stable with LOG_PRIVACY_KEY and redacts more credential formats', () => {
  const originalWarn = console.warn;
  const outputs = [];
  console.warn = (value) => outputs.push(JSON.parse(String(value)));
  const privacyKey = 'Stable-Log-Privacy-Key-32+Unique-Characters!';
  try {
    createStructuredLogger({ privacyKey }).warn('request api_key=plain-secret-value', {
      userId: '99887766',
      note: `github_pat_${'a'.repeat(30)}`,
      callback: `https://example.test/cb?access_token=${'b'.repeat(30)}&mode=ok`
    });
    createStructuredLogger({ privacyKey }).warn('second', { userId: '99887766' });
    createStructuredLogger({ privacyKey: `${privacyKey}-different` }).warn('third', { userId: '99887766' });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(outputs[0].meta.userId, outputs[1].meta.userId);
  assert.notEqual(outputs[0].meta.userId, outputs[2].meta.userId);
  const serialized = JSON.stringify(outputs[0]);
  assert.doesNotMatch(serialized, /plain-secret-value|github_pat_|bbbbbbbb/);
  assert.match(serialized, /REDACTED/);
});
