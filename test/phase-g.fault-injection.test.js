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

test('fault injection: admin api returns 500 for injected db fault and recovers', async (t) => {
  ensureBuiltInAIProvidersRegistered();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-fault-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();
  await db.upsertUser({ id: 5001, username: 'admin', first_name: 'Admin', language_code: 'en' });
  db.setUserRoles('5001', ['admin']);

  const config = {
    adminApiEnabled: true,
    adminApiToken: 'fault-token',
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
  const authHeader = ['Bearer', config.adminApiToken].join(' ');
  const headers = {
    Authorization: authHeader,
    'x-admin-user-id': '5001'
  };

  const originalListUsers = db.listUsers.bind(db);
  db.listUsers = () => {
    throw new Error('Injected database unavailable');
  };

  const failed = await fetch(`http://127.0.0.1:${port}/admin/api/v1/users`, { headers });
  assert.equal(failed.status, 500);

  db.listUsers = originalListUsers;
  const recovered = await fetch(`http://127.0.0.1:${port}/admin/api/v1/users`, { headers });
  assert.equal(recovered.status, 200);
});

test('fault injection: sqlite state survives process restart', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-restart-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const databaseFile = path.join(tempDir, 'bot-data.db');
  const first = new BotDatabase(databaseFile);
  await first.init();
  await first.setConversation('3:8:main', [
    { role: 'user', content: 'before restart' },
    { role: 'assistant', content: 'persist me' }
  ]);
  await first.write();
  first.db.close();

  const second = new BotDatabase(databaseFile);
  await second.init();
  const conversation = second.getConversation('3:8:main');
  assert.equal(conversation.length, 2);
  assert.equal(conversation[1].content, 'persist me');
});
