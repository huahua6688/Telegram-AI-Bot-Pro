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

test('runtime config rejects missing provider API key', () => {
  const errors = getRuntimeConfigErrors(validConfig({ geminiApiKey: '' }));

  assert.ok(errors.some((item) => item.includes('gemini requires')));
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
