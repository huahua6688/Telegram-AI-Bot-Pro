import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BotDatabase } from '../src/db.js';
import { AccessControlService } from '../src/services/access-control-service.js';

test('AccessControlService applies block > allow > default and admin role checks', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-access-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();
  await db.upsertUser({ id: 100, username: 'alice', first_name: 'Alice', language_code: 'en' });
  await db.upsertUser({ id: 101, username: 'bob', first_name: 'Bob', language_code: 'en' });

  const config = {
    adminUserIds: new Set(),
    blockedUserIds: new Set(),
    allowedUserIds: new Set(),
    allowedChatIds: new Set()
  };
  const access = new AccessControlService({
    config,
    db,
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });
  db.setUserRoles(100, ['admin']);
  assert.equal(access.isAdmin('100'), true);

  db.upsertPolicyRule({ effect: 'allow', subjectType: 'user', subjectId: '101', createdBy: 'system' });
  let decision = access.canAccessBot({ userId: '101', chatId: '1' });
  assert.equal(decision.allowed, true);

  db.upsertPolicyRule({ effect: 'block', subjectType: 'user', subjectId: '101', createdBy: 'system' });
  decision = access.canAccessBot({ userId: '101', chatId: '1' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'ACCESS_BLOCKED');
});
