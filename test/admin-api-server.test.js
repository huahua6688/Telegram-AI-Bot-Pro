import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BotDatabase } from '../src/db.js';
import { AccessControlService } from '../src/services/access-control-service.js';
import { startAdminApiServer } from '../src/services/admin-api-server.js';
import { ensureBuiltInAIProvidersRegistered } from '../src/services/ai-provider-registry.js';

function logger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

test('Admin API authenticates token and enforces RBAC', async (t) => {
  ensureBuiltInAIProvidersRegistered();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-admin-api-'));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();
  await db.upsertUser({ id: 9001, username: 'admin', first_name: 'Admin', language_code: 'en' });
  await db.upsertUser({ id: 9002, username: 'viewer', first_name: 'Viewer', language_code: 'en' });
  db.setUserRoles('9001', ['admin']);
  db.setUserRoles('9002', ['viewer']);

  const config = {
    adminApiEnabled: true,
    adminApiToken: 'test-token',
    adminApiPrefix: '/admin/api/v1',
    aiProvider: 'openai-compatible',
    availableModels: ['gpt-4.1-mini'],
    defaultModel: 'gpt-4.1-mini',
    dailyQuota: 200,
    adminUserIds: new Set(),
    blockedUserIds: new Set(),
    allowedUserIds: new Set(),
    allowedChatIds: new Set()
  };
  const accessControl = new AccessControlService({ config, db, logger: logger() });
  const server = startAdminApiServer({ config, db, logger: logger(), accessControl, port: 0 });
  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const port = server.address().port;

  const unauthorized = await fetch(`http://127.0.0.1:${port}/admin/api/v1/users`);
  assert.equal(unauthorized.status, 401);

  const forbidden = await fetch(`http://127.0.0.1:${port}/admin/api/v1/users/9002`, {
    method: 'PATCH',
    headers: {
      Authorization: ['Bearer', 'test-token'].join(' '),
      'x-admin-user-id': '9002',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ isBlocked: true })
  });
  assert.equal(forbidden.status, 403);

  const success = await fetch(`http://127.0.0.1:${port}/admin/api/v1/users`, {
    headers: {
      Authorization: ['Bearer', 'test-token'].join(' '),
      'x-admin-user-id': '9001'
    }
  });
  assert.equal(success.status, 200);
  const body = await success.json();
  assert.equal(Array.isArray(body.items), true);

  const initialQuota = await fetch(`http://127.0.0.1:${port}/admin/api/v1/quota?userId=9002`, {
    headers: {
      Authorization: ['Bearer', 'test-token'].join(' '),
      'x-admin-user-id': '9001'
    }
  });
  assert.equal(initialQuota.status, 200);
  assert.deepEqual(await initialQuota.json(), {
    userId: '9002',
    dailyUsageDate: '',
    dailyUsageCount: 0,
    globalDailyQuota: 200,
    dailyQuota: 200,
    dailyQuotaOverride: null,
    usesGlobalQuota: true
  });

  const setQuota = await fetch(`http://127.0.0.1:${port}/admin/api/v1/quota`, {
    method: 'PATCH',
    headers: {
      Authorization: ['Bearer', 'test-token'].join(' '),
      'x-admin-user-id': '9001',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userId: '9002', dailyQuota: 7 })
  });
  assert.equal(setQuota.status, 200);
  const setQuotaBody = await setQuota.json();
  assert.deepEqual(setQuotaBody.quota, {
    userId: '9002',
    dailyQuota: 7,
    dailyQuotaOverride: 7,
    usesGlobalQuota: false
  });
  assert.equal(db.consumeDailyQuota('9002', config.dailyQuota).quota, 7);

  const malformedQuota = await fetch(`http://127.0.0.1:${port}/admin/api/v1/quota`, {
    method: 'PATCH',
    headers: {
      Authorization: ['Bearer', 'test-token'].join(' '),
      'x-admin-user-id': '9001',
      'Content-Type': 'application/json'
    },
    body: '{'
  });
  assert.equal(malformedQuota.status, 400);
  assert.equal((await malformedQuota.json()).error, 'INVALID_JSON');
  assert.equal(db.findUser('9002').dailyUsageCount, 1);

  const resetQuota = await fetch(`http://127.0.0.1:${port}/admin/api/v1/quota`, {
    method: 'PATCH',
    headers: {
      Authorization: ['Bearer', 'test-token'].join(' '),
      'x-admin-user-id': '9001',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ userId: '9002', dailyQuota: null })
  });
  assert.equal(resetQuota.status, 200);
  const resetQuotaBody = await resetQuota.json();
  assert.equal(resetQuotaBody.quota.dailyQuota, 200);
  assert.equal(resetQuotaBody.quota.usesGlobalQuota, true);

  const accidentalReset = await fetch(`http://127.0.0.1:${port}/admin/api/v1/quota`, {
    method: 'PATCH',
    headers: {
      Authorization: ['Bearer', 'test-token'].join(' '),
      'x-admin-user-id': '9001',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  assert.equal(accidentalReset.status, 400);
  assert.equal((await accidentalReset.json()).error, 'EXPLICIT_RESET_REQUIRED');
  assert.equal(db.findUser('9002').dailyUsageCount, 1);

  const explicitReset = await fetch(`http://127.0.0.1:${port}/admin/api/v1/quota`, {
    method: 'PATCH',
    headers: {
      Authorization: ['Bearer', 'test-token'].join(' '),
      'x-admin-user-id': '9001',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ resetAll: true })
  });
  assert.equal(explicitReset.status, 200);
  assert.equal(db.findUser('9002').dailyUsageCount, 0);
});
