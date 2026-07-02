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
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

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
  t.after(() => server?.close());
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
});
