import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BotDatabase } from '../src/db.js';

test('BotDatabase imports legacy JSON data into SQLite', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const databaseFile = path.join(tempDir, 'bot-data.db');
  const legacyFile = path.join(tempDir, 'bot-data.json');
  await fs.writeFile(
    legacyFile,
    JSON.stringify({
      meta: { createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-02T00:00:00.000Z' },
      users: [
        {
          id: '100',
          username: 'alice',
          firstName: 'Alice',
          lastName: 'Lee',
          preferredLanguage: 'en',
          persona: 'coder',
          dailyUsageDate: '2024-01-01',
          dailyUsageCount: 2,
          totalMessages: 5,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z'
        }
      ],
      chats: [
        {
          id: '200',
          type: 'group',
          title: 'Team Chat',
          triggerMode: 'mention',
          keyword: 'bot',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z'
        }
      ],
      conversations: [
        {
          sessionId: '200:100:main',
          messages: [{ role: 'user', content: 'hello' }],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z'
        }
      ],
      stats: {
        messagesHandled: 3,
        aiCalls: 4,
        toolCalls: 1,
        voiceTranscriptions: 0,
        imageGenerations: 0,
        ttsGenerations: 0,
        startedAt: '2024-01-01T00:00:00.000Z'
      }
    })
  );

  const db = new BotDatabase(databaseFile, legacyFile);
  await db.init();

  assert.equal(db.findUser('100')?.username, 'alice');
  assert.equal(db.findChat('200')?.triggerMode, 'mention');
  assert.deepEqual(db.getConversation('200:100:main'), [{ role: 'user', content: 'hello' }]);
  assert.equal(db.getStats().aiCalls, 4);
  assert.equal(db.getMeta('schemaVersion'), '3');
});

test('BotDatabase provides RBAC, feature flags, policy rules and audit logs', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();
  await db.upsertUser({ id: 77, username: 'rbac-user', first_name: 'Rbac', language_code: 'en' });

  db.setUserRoles(77, ['operator']);
  const roles = db.listUserRoleNames(77);
  assert.deepEqual(roles, ['operator']);
  assert.equal(db.listUserPermissions(77).includes('users:read'), true);

  db.upsertFeatureFlag({ flagKey: 'admin.export.audit', scopeType: 'global', enabled: false, updatedBy: 'system' });
  db.upsertFeatureFlag({ flagKey: 'admin.export.audit', scopeType: 'user', scopeId: '77', enabled: true, updatedBy: 'system' });
  assert.equal(db.resolveFeatureFlag('admin.export.audit', { userId: '77' }), true);

  const blockRule = db.upsertPolicyRule({
    effect: 'block',
    subjectType: 'user',
    subjectId: '77',
    note: 'manual block',
    createdBy: 'admin'
  });
  assert.equal(blockRule.effect, 'block');
  assert.equal(
    db.matchPolicyRule({ effect: 'block', userId: '77', chatId: '', roleNames: [] }),
    true
  );

  db.logAudit({
    actorId: 'admin',
    actorType: 'admin_api',
    action: 'users.update',
    targetType: 'user',
    targetId: '77',
    details: { isBlocked: true }
  });
  const logs = db.listAuditLogs({ actorId: 'admin' });
  assert.equal(logs.length > 0, true);
});

test('BotDatabase persists updates, quota counters, and favorites', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();
  await db.upsertUser({ id: 1, username: 'tester', first_name: 'Test', language_code: 'zh-CN' });
  await db.upsertChat({ id: 2, type: 'private', title: '' }, { triggerMode: 'smart', keyword: 'ai' });
  await db.setUserSettings(1, { preferredModel: 'gpt-4.1', isAllowed: true });
  await db.setChatSettings(2, { keyword: 'hello' });
  const result = db.consumeDailyQuota(1, 2);
  await db.write();

  await db.setConversation('2:1:main', [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'assistant text' }
  ]);
  const latest = db.getLatestAssistantMessageReference('2:1:main');

  const favorite = await db.saveFavorite({
    chatId: 2,
    userId: 1,
    sessionId: '2:1:main',
    messageId: 101,
    messageVersionId: latest?.messageVersionId,
    targetType: latest?.messageVersionId ? 'message_version' : 'message',
    targetId: latest?.messageVersionId || '101',
    text: 'assistant text',
    sourceText: 'user question',
    model: 'gpt-4.1',
    locale: 'zh'
  });

  assert.equal(result.allowed, true);
  assert.equal(db.findUser(1)?.preferredModel, 'gpt-4.1');
  assert.equal(db.findUser(1)?.isAllowed, true);
  assert.equal(db.findChat(2)?.keyword, 'hello');
  assert.equal(db.findUser(1)?.dailyUsageCount, 1);
  assert.equal(favorite?.text, 'assistant text');
  assert.equal(db.listFavorites({ userId: 1 }).length, 1);
});

test('BotDatabase tracks assistant regenerate message versions', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();

  const sessionId = '200:100:main';
  await db.setConversation(sessionId, [
    { role: 'user', content: 'Q1' },
    { role: 'assistant', content: 'A1' }
  ]);
  const firstRef = db.getLatestAssistantMessageReference(sessionId);
  assert.equal(firstRef?.version, 1);

  await db.setConversation(sessionId, [
    { role: 'user', content: 'Q1' },
    { role: 'assistant', content: 'A1 regenerated' }
  ]);
  const secondRef = db.getLatestAssistantMessageReference(sessionId);

  assert.equal(secondRef?.messageId, firstRef?.messageId);
  assert.equal(secondRef?.version, 2);

  const versions = db.getMessageVersionHistory(firstRef.messageId);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].isCurrent, true);
  assert.equal(versions[0].content, 'A1 regenerated');
});

test('BotDatabase supports multi-session lifecycle and prompts', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();

  await db.setConversation('300:9:main', [{ role: 'user', content: 'hello' }]);
  const customSession = await db.createSession({ chatId: 300, userId: 9, threadId: 'main', name: 'work', isDefault: false });
  await db.setConversation(customSession.id, [{ role: 'user', content: 'session B' }]);

  const active = db.listSessions({ chatId: 300, userId: 9, status: 'active' });
  assert.equal(active.length, 2);

  await db.setSessionStatus(customSession.id, 'archived');
  const archived = db.listSessions({ chatId: 300, userId: 9, status: 'archived' });
  assert.equal(archived.length, 1);

  const promptV1 = await db.savePrompt({
    promptKey: 'session-main-system',
    ownerUserId: '9',
    chatId: '300',
    sessionId: '300:9:main',
    scope: 'session',
    kind: 'system',
    name: 'Main Prompt',
    content: 'You are concise',
    isDefault: true
  });

  const promptV2 = await db.savePrompt({
    promptKey: 'session-main-system',
    ownerUserId: '9',
    chatId: '300',
    sessionId: '300:9:main',
    scope: 'session',
    kind: 'system',
    name: 'Main Prompt',
    content: 'You are concise and accurate',
    isDefault: true
  });

  assert.equal(promptV1.version, 1);
  assert.equal(promptV2.version, 2);
  assert.ok(db.listPrompts({ ownerUserId: '9', scope: 'session' }).length >= 2);
});

test('BotDatabase migration from legacy conversations to structured history is idempotent', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();

  await db.setConversation('888:7:main', [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' }
  ]);

  db.migrateConversationsToStructuredHistory();
  const messageCountBefore = db.db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get('888:7:main').count;
  const versionCountBefore = db.db
    .prepare(
      `SELECT COUNT(*) AS count\n       FROM message_versions mv\n       JOIN messages m ON m.id = mv.message_id\n       WHERE m.session_id = ?`
    )
    .get('888:7:main').count;
  db.migrateConversationsToStructuredHistory();

  const entries = db.getConversationEntries('888:7:main');
  assert.equal(entries.length, 2);
  const assistant = db.getLatestAssistantMessageReference('888:7:main');
  assert.equal(assistant.version, 1);
  const messageCountAfter = db.db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get('888:7:main').count;
  const versionCountAfter = db.db
    .prepare(
      `SELECT COUNT(*) AS count\n       FROM message_versions mv\n       JOIN messages m ON m.id = mv.message_id\n       WHERE m.session_id = ?`
    )
    .get('888:7:main').count;
  assert.equal(messageCountAfter, messageCountBefore);
  assert.equal(versionCountAfter, versionCountBefore);
});
