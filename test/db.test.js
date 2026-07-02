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
});

test('BotDatabase persists updates and quota counters in SQLite', async (t) => {
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
  const favorite = await db.saveFavorite({
    chatId: 2,
    userId: 1,
    messageId: 101,
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
  assert.equal(db.findFavorite(2, 1, 101)?.model, 'gpt-4.1');
});
