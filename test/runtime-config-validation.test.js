import test from 'node:test';
import assert from 'node:assert/strict';
import { getRuntimeConfigErrors, assertRuntimeConfig } from '../src/app/runtime-config-validation.js';

function validConfig(overrides = {}) {
  return {
    botToken: '123456:telegram-token',
    aiProvider: 'gemini',
    geminiApiKey: 'gemini-key',
    defaultModel: 'gemini-2.5-flash',
    adminApiEnabled: false,
    adminApiToken: '',
    ...overrides
  };
}

test('runtime config accepts a valid Gemini config', () => {
  assert.deepEqual(getRuntimeConfigErrors(validConfig()), []);
  assert.doesNotThrow(() => assertRuntimeConfig(validConfig()));
});

test('runtime config rejects missing bot token', () => {
  const errors = getRuntimeConfigErrors(validConfig({ botToken: '' }));

  assert.ok(errors.some((item) => item.includes('BOT_TOKEN')));
  assert.throws(() => assertRuntimeConfig(validConfig({ botToken: '' })), /BOT_TOKEN/);
});

test('runtime config allows missing provider API key so deployment can start', () => {
  const errors = getRuntimeConfigErrors(validConfig({ geminiApiKey: '' }));

  assert.deepEqual(errors, []);
  assert.doesNotThrow(() => assertRuntimeConfig(validConfig({ geminiApiKey: '' })));
});

test('runtime config rejects enabled Admin API without token', () => {
  const errors = getRuntimeConfigErrors(
    validConfig({
      adminApiEnabled: true,
      adminApiToken: ''
    })
  );

  assert.ok(errors.some((item) => item.includes('ADMIN_API_TOKEN')));
});

test('runtime config accepts enabled Admin API with token', () => {
  const errors = getRuntimeConfigErrors(
    validConfig({
      adminApiEnabled: true,
      adminApiToken: 'strong-admin-token'
    })
  );

  assert.deepEqual(errors, []);
});

test('runtime config fails closed when Agent isolation or billing secrets are incomplete', () => {
  const errors = getRuntimeConfigErrors(validConfig({ agentEnabled: true }));
  assert.ok(errors.some((item) => item.includes('BILLING_USD_PER_CHAT_CREDIT')));
  assert.ok(errors.some((item) => item.includes('AGENT_WORKER_URL')));
  assert.ok(errors.some((item) => item.includes('AGENT_WORKER_SECRET')));
  assert.ok(errors.some((item) => item.includes('GITHUB_APP_CLIENT_ID')));
  assert.ok(errors.some((item) => item.includes('GITHUB_TOKEN_ENCRYPTION_KEY')));
});

test('runtime config accepts a separately configured support bot', () => {
  const errors = getRuntimeConfigErrors(validConfig({
    supportEnabled: true,
    supportBotToken: '654321:support-token',
    supportAdminIds: '10001, 10002'
  }));

  assert.deepEqual(errors, []);
});

test('runtime config rejects a reused main token and missing support administrators', () => {
  const errors = getRuntimeConfigErrors(validConfig({
    supportEnabled: true,
    supportBotToken: '123456:telegram-token',
    supportAdminIds: new Set()
  }));

  assert.ok(errors.some((item) => item.includes('SUPPORT_BOT_TOKEN_CONFLICT')));
  assert.ok(errors.some((item) => item.includes('MISSING_SUPPORT_ADMIN_IDS')));
  assert.throws(
    () => assertRuntimeConfig(validConfig({
      supportEnabled: true,
      supportBotToken: '123456:telegram-token',
      supportAdminIds: []
    })),
    /SUPPORT_BOT_TOKEN_CONFLICT[\s\S]*MISSING_SUPPORT_ADMIN_IDS/
  );
});

test('runtime config rejects malformed support administrator IDs', () => {
  const errors = getRuntimeConfigErrors(validConfig({
    supportEnabled: true,
    supportBotToken: '654321:support-token',
    supportAdminIds: new Set(['10001', '@admin'])
  }));

  assert.ok(errors.some((item) => item.includes('INVALID_SUPPORT_ADMIN_IDS')));
});

test('runtime config ignores dormant support bot credentials when support is disabled', () => {
  const errors = getRuntimeConfigErrors(validConfig({
    supportEnabled: false,
    supportBotToken: '123456:telegram-token',
    supportAdminIds: []
  }));

  assert.deepEqual(errors, []);
});
