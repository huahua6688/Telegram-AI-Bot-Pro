import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { loadConfig } from '../src/config.js';
import { BotDatabase } from '../src/db.js';
import { startHealthServer } from '../src/services/health-server.js';

function logger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

test('smoke: config defaults remain valid for deployment baseline', () => {
  const original = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    HEALTH_PORT: process.env.HEALTH_PORT,
    ADMIN_API_PORT: process.env.ADMIN_API_PORT,
    DATABASE_FILE: process.env.DATABASE_FILE
  };
  process.env.AI_PROVIDER = 'openai-compatible';
  process.env.HEALTH_PORT = '3000';
  process.env.ADMIN_API_PORT = '3001';
  process.env.DATABASE_FILE = './data/bot-data.db';

  const config = loadConfig();
  assert.equal(config.aiProvider, 'openai-compatible');
  assert.equal(config.healthPort, 3000);
  assert.equal(config.adminApiPort, 3001);
  assert.ok(config.databaseFile.endsWith(path.join('data', 'bot-data.db')));

  process.env.AI_PROVIDER = original.AI_PROVIDER;
  process.env.HEALTH_PORT = original.HEALTH_PORT;
  process.env.ADMIN_API_PORT = original.ADMIN_API_PORT;
  process.env.DATABASE_FILE = original.DATABASE_FILE;
});

test('smoke: health endpoint is reachable with sqlite runtime', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-smoke-'));
  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();

  const server = startHealthServer({
    port: 0,
    db,
    config: { defaultModel: 'gpt-4.1-mini' },
    logger: logger()
  });
  try {
    if (!server.listening) await once(server, 'listening');
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.model, 'gpt-4.1-mini');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.db?.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
