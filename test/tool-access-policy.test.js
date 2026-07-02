import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolAccessPolicy } from '../src/services/tool-access-policy.js';

function createConfig() {
  return {
    enableToolCalls: true,
    toolAllowedNames: new Set(['get_time', 'web_search', 'fetch_url']),
    toolAllowedUserIds: new Set(),
    toolAllowedChatIds: new Set(),
    toolBlockedUserIds: new Set(),
    toolAdminOnlyNames: new Set(['fetch_url']),
    toolMaxCallsPerMessage: 4,
    toolUserWindowMs: 60000,
    toolUserMaxCalls: 2,
    networkToolScope: 'allowlist',
    networkToolAllowedUserIds: new Set(['42']),
    networkToolAllowedChatIds: new Set()
  };
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {}
  };
}

test('ToolAccessPolicy enforces network allowlist and admin-only tools', () => {
  const policy = new ToolAccessPolicy(createConfig(), createLogger());

  const deniedNetwork = policy.authorize('web_search', { userId: '1', chatId: '1', isAdmin: false });
  assert.equal(deniedNetwork.allowed, false);
  assert.equal(deniedNetwork.code, 'NETWORK_TOOL_NOT_AUTHORIZED');

  const deniedAdminOnly = policy.authorize('fetch_url', { userId: '42', chatId: '1', isAdmin: false });
  assert.equal(deniedAdminOnly.allowed, false);
  assert.equal(deniedAdminOnly.code, 'TOOL_ADMIN_ONLY');

  const allowedAdmin = policy.authorize('fetch_url', { userId: '42', chatId: '1', isAdmin: true });
  assert.equal(allowedAdmin.allowed, true);
});
test('ToolAccessPolicy enforces per-user rate limits', () => {
  const policy = new ToolAccessPolicy(createConfig(), createLogger());
  const context = { userId: '42', chatId: '1', isAdmin: true };
  assert.equal(policy.authorize('get_time', context).allowed, true);
  assert.equal(policy.authorize('get_time', context).allowed, true);
  const limited = policy.authorize('get_time', context);
  assert.equal(limited.allowed, false);
  assert.equal(limited.code, 'TOOL_RATE_LIMITED');
});
