import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BotDatabase } from '../src/db.js';
import { AccessControlService } from '../src/services/access-control-service.js';
import { startAdminApiServer } from '../src/services/admin-api-server.js';
import { startHealthServer } from '../src/services/health-server.js';
import { ensureBuiltInAIProvidersRegistered } from '../src/services/ai-provider-registry.js';

function logger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

test('e2e: provider switch + persistence + admin api flow', async (t) => {
  ensureBuiltInAIProvidersRegistered();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-e2e-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();
  await db.upsertUser({ id: 7001, username: 'admin', first_name: 'Admin', language_code: 'en' });
  await db.upsertUser({ id: 7002, username: 'user', first_name: 'User', language_code: 'zh-CN' });
  db.setUserRoles('7001', ['admin']);
  await db.setConversation('99:7002:main', [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'world' }
  ]);

  const config = {
    adminApiEnabled: true,
    adminApiToken: 'phase-g-token',
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
  const healthServer = startHealthServer({ port: 0, db, config, logger: logger() });
  const adminServer = startAdminApiServer({ config, db, logger: logger(), accessControl, port: 0 });
  t.after(() => {
    healthServer.close();
    adminServer?.close();
  });

  const healthPort = healthServer.address().port;
  const adminPort = adminServer.address().port;
  const authHeader = ['Bearer', config.adminApiToken].join(' ');
  const headers = {
    Authorization: authHeader,
    'x-admin-user-id': '7001',
    'Content-Type': 'application/json'
  };

  const healthRes = await fetch(`http://127.0.0.1:${healthPort}/`);
  assert.equal(healthRes.status, 200);

  const providersRes = await fetch(`http://127.0.0.1:${adminPort}/admin/api/v1/providers`, { headers });
  assert.equal(providersRes.status, 200);

  const switchRes = await fetch(`http://127.0.0.1:${adminPort}/admin/api/v1/providers/qwen`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ isDefault: true, enabled: true })
  });
  assert.equal(switchRes.status, 200);
  assert.equal(db.listProviderConfigs().find((item) => item.providerId === 'qwen')?.isDefault, true);

  const sessionsRes = await fetch(`http://127.0.0.1:${adminPort}/admin/api/v1/sessions?userId=7002`, { headers });
  assert.equal(sessionsRes.status, 200);
  const sessionsBody = await sessionsRes.json();
  assert.equal(sessionsBody.items.length >= 1, true);

  const sessionId = sessionsBody.items[0].id;
  const sessionDetailRes = await fetch(`http://127.0.0.1:${adminPort}/admin/api/v1/sessions/${encodeURIComponent(sessionId)}?limit=10`, { headers });
  assert.equal(sessionDetailRes.status, 200);
  const detailBody = await sessionDetailRes.json();
  assert.equal(detailBody.messages.length >= 1, true);
});
