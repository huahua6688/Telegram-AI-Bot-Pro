import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { BotDatabase } from '../src/db.js';

test('load: database handles message burst within baseline threshold', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-load-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();
  await db.upsertUser({ id: 1, username: 'load', first_name: 'Load', language_code: 'en' });
  await db.upsertChat({ id: 1, type: 'private', title: '' }, { triggerMode: 'smart', keyword: 'ai' });

  const loops = Number.parseInt(process.env.PHASE_G_LOAD_LOOPS || '300', 10);
  const thresholdMs = Number.parseInt(process.env.PHASE_G_LOAD_THRESHOLD_MS || '15000', 10);

  const start = performance.now();
  for (let i = 0; i < loops; i += 1) {
    await db.setConversation('1:1:main', [
      { role: 'user', content: `msg-${i}` },
      { role: 'assistant', content: `reply-${i}` }
    ]);
    db.consumeDailyQuota(1, 999999);
  }
  const duration = performance.now() - start;

  assert.equal(db.getConversation('1:1:main').length, 2);
  assert.equal(duration < thresholdMs, true, `load baseline exceeded: ${duration.toFixed(2)}ms >= ${thresholdMs}ms`);
});
