import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BotDatabase } from '../src/db.js';

test('BotDatabase imports legacy JSON data into SQLite', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));

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
  t.after(() => {
    db.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
  await db.init();

  assert.equal(db.findUser('100')?.username, 'alice');
  assert.equal(db.findChat('200')?.triggerMode, 'mention');
  assert.deepEqual(db.getConversation('200:100:main'), [{ role: 'user', content: 'hello' }]);
  assert.equal(db.getStats().aiCalls, 4);
  assert.equal(db.getMeta('schemaVersion'), '8');
});

test('BotDatabase provides RBAC, feature flags, policy rules and audit logs', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  t.after(() => {
    db.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
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

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  t.after(() => {
    db.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
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

test('BotDatabase applies persistent per-user daily quota overrides', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));
  const databaseFile = path.join(tempDir, 'bot-data.db');

  const db = new BotDatabase(databaseFile);
  let reopened = null;
  t.after(() => {
    db.close();
    reopened?.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
  await db.init();
  await db.upsertUser({ id: 10, username: 'limited', first_name: 'Limited', language_code: 'zh-CN' });

  assert.deepEqual(db.getUserDailyQuota(10, 3), {
    userId: '10',
    dailyQuota: 3,
    dailyQuotaOverride: null,
    usesGlobalQuota: true
  });

  assert.deepEqual(db.setUserDailyQuota(10, 1), {
    userId: '10',
    dailyQuota: 1,
    dailyQuotaOverride: 1,
    usesGlobalQuota: false
  });
  assert.equal(db.findUser(10)?.dailyQuotaOverride, 1);

  const first = db.consumeDailyQuota(10, 3);
  assert.deepEqual(first, { allowed: true, remaining: 0, quota: 1, dailyQuotaOverride: 1 });
  assert.deepEqual(db.consumeDailyQuota(10, 3), {
    allowed: false,
    remaining: 0,
    quota: 1,
    dailyQuotaOverride: 1
  });
  db.refundDailyQuota(10);
  assert.equal(db.findUser(10)?.dailyUsageCount, 0);
  assert.equal(db.findUser(10)?.totalMessages, 0);
  assert.deepEqual(db.consumeDailyQuota(10, 3), {
    allowed: true,
    remaining: 0,
    quota: 1,
    dailyQuotaOverride: 1
  });
  assert.equal(db.findUser(10)?.totalMessages, 1);

  db.close();
  reopened = new BotDatabase(databaseFile);
  await reopened.init();
  assert.equal(reopened.getUserDailyQuota(10, 3)?.dailyQuotaOverride, 1);

  assert.deepEqual(reopened.clearUserDailyQuota(10, 3), {
    userId: '10',
    dailyQuota: 3,
    dailyQuotaOverride: null,
    usesGlobalQuota: true
  });
  assert.equal(reopened.getUserDailyQuota(10, 3)?.dailyQuota, 3);
  assert.deepEqual(reopened.consumeDailyQuota(10, 3), {
    allowed: true,
    remaining: 1,
    quota: 3,
    dailyQuotaOverride: null
  });
});

test('BotDatabase treats a zero user quota override as unlimited and validates input', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));
  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  t.after(() => {
    db.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
  await db.init();
  await db.upsertUser({ id: 11, username: 'unlimited', first_name: 'Unlimited', language_code: 'en' });

  db.setUserDailyQuota(11, 0);
  assert.deepEqual(db.consumeDailyQuota(11, 1), {
    allowed: true,
    remaining: Infinity,
    quota: 0,
    dailyQuotaOverride: 0
  });
  assert.deepEqual(db.consumeDailyQuota(11, 1), {
    allowed: true,
    remaining: Infinity,
    quota: 0,
    dailyQuotaOverride: 0
  });
  db.setUserDailyUsage(11, 8, '2000-01-01');
  assert.equal(db.getOperationsMetrics().quotaConsumedToday, 0);
  assert.throws(() => db.setUserDailyQuota(11, -1), /non-negative safe integer/);
  assert.throws(() => db.setUserDailyQuota(11, 1.5), /non-negative safe integer/);
  assert.equal(db.setUserDailyQuota(999, 5), null);
});

test('BotDatabase upgrades a v5 database through quota and Stars billing storage', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));
  const databaseFile = path.join(tempDir, 'bot-data.db');
  const db = new BotDatabase(databaseFile);
  let upgraded = null;
  t.after(() => {
    db.close();
    upgraded?.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });

  await db.init();
  await db.upsertUser({ id: 12, username: 'upgrade', first_name: 'Upgrade', language_code: 'en' });
  db.db.exec('DROP TABLE user_quota_settings');
  db.setMeta('schemaVersion', '5');
  db.close();

  upgraded = new BotDatabase(databaseFile);
  await upgraded.init();
  assert.equal(upgraded.getMeta('schemaVersion'), '8');
  assert.equal(upgraded.setUserDailyQuota(12, 9, 3)?.dailyQuota, 9);
  assert.equal(upgraded.findUser(12)?.dailyQuotaOverride, 9);
});

test('BotDatabase persists per-user AI provider settings', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  let reopened = null;
  t.after(() => {
    db.close();
    reopened?.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
  await db.init();
  await db.upsertUser({ id: 9, username: 'provider-user', first_name: 'Provider', language_code: 'en' });

  db.setUserProvider(9, 'groq');
  db.setUserModel(9, 'llama-current');
  db.setUserFallbackEnabled(9, false);

  let settings = db.getUserAISettings(9);
  assert.equal(settings.providerId, 'groq');
  assert.equal(settings.modelId, 'llama-current');
  assert.equal(settings.fallbackEnabled, false);

  db.close();
  reopened = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await reopened.init();
  settings = reopened.getUserAISettings(9);
  assert.equal(settings.providerId, 'groq');
  assert.equal(settings.modelId, 'llama-current');
  assert.equal(settings.fallbackEnabled, false);
});

test('BotDatabase tracks assistant regenerate message versions', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-db-'));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  t.after(() => {
    db.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
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

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  t.after(() => {
    db.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
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

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  t.after(() => {
    db.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
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
