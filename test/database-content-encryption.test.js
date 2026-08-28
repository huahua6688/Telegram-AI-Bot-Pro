import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BotDatabase } from '../src/db.js';
import { installDatabaseContentEncryption } from '../src/services/database-content-encryption.js';

test('database content encryption migrates chats, topic summaries, and long-term memory', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-encrypted-db-'));
  const databaseFile = path.join(directory, 'bot.db');
  const db = new BotDatabase(databaseFile);
  await db.init();
  t.after(async () => {
    db.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  await db.setConversation('session:1:2', [{ role: 'user', content: 'private chat text' }]);
  db.upsertMemoryItem({
    id: 'memory-1', userId: '1', chatId: '2', topicId: 'general',
    key: 'preference', value: 'private memory text'
  });
  db.upsertTopicState({
    userId: '1', chatId: '2', topicId: 'general', title: 'Private topic',
    summary: 'private summary text', currentGoal: 'private goal', lastStep: 'private step', nextStep: 'private next step'
  });

  const encryption = installDatabaseContentEncryption(db, {
    secret: 'Chat-Encryption-Key-32+Unique-Characters!1',
    required: true
  });
  assert.equal(encryption.enabled, true);
  assert.equal(encryption.migrated.encryptedMemoryItems, 1);
  assert.equal(encryption.migrated.encryptedTopicFields, 5);

  const rawMemory = db.db.prepare('SELECT value FROM memory_items WHERE id = ?').get('memory-1').value;
  const rawTopic = db.db.prepare('SELECT summary FROM topic_states WHERE topic_id = ?').get('general').summary;
  const rawConversation = db.db.prepare('SELECT messages_json FROM conversations WHERE session_id = ?').get('session:1:2').messages_json;
  for (const raw of [rawMemory, rawTopic, rawConversation]) {
    assert.match(raw, /^enc:v1:/);
    assert.doesNotMatch(raw, /private/i);
  }

  assert.equal(db.getMemoryItems({ userId: '1', chatId: '2', topicId: 'general' })[0].value, 'private memory text');
  assert.equal(db.getTopicState({ userId: '1', chatId: '2', topicId: 'general' }).summary, 'private summary text');
  assert.equal(db.getConversation('session:1:2')[0].content, 'private chat text');

  db.upsertMemoryItem({
    id: 'memory-2', userId: '1', chatId: '2', topicId: 'general', key: 'style', value: 'new private memory'
  });
  assert.match(db.db.prepare('SELECT value FROM memory_items WHERE id = ?').get('memory-2').value, /^enc:v1:/);
});
