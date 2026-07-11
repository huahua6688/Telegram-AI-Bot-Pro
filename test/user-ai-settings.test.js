import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BotDatabase } from '../src/db.js';

test('user AI settings save provider model and fallback flag', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-user-ai-'));
  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  t.after(() => {
    db.close();
    return fs.rm(tempDir, { recursive: true, force: true });
  });
  await db.init();
  await db.upsertUser({ id: 42, username: 'model-user', first_name: 'Model', language_code: 'en' });

  db.setUserAISettings(42, { providerId: 'openrouter', modelId: 'vendor/model:free', fallbackEnabled: false });
  const settings = db.getUserAISettings(42);
  assert.equal(settings.providerId, 'openrouter');
  assert.equal(settings.modelId, 'vendor/model:free');
  assert.equal(settings.fallbackEnabled, false);
});
