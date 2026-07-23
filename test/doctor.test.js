import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('deployment doctor accepts one configured provider and warns that fallback is not independent', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-doctor-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const env = { ...process.env };
  for (const name of [
    'AI_API_KEY',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'GEMINI_LIVE_API_KEY',
    'BRAVE_SEARCH_API_KEY'
  ]) {
    delete env[name];
  }
  Object.assign(env, {
    BOT_TOKEN: '123456:test-token',
    ADMIN_USER_IDS: '123456',
    DEFAULT_AI_PROVIDER: 'gemini',
    DEFAULT_AI_MODEL: 'gemini-2.5-flash',
    GEMINI_API_KEY: 'test-gemini-key',
    ENABLE_PROVIDER_FALLBACK: 'true',
    ENABLE_WEB_SEARCH: 'false',
    PORT: '8080',
    HEALTH_PORT: '8080',
    DATABASE_FILE: path.join(tempDir, 'bot-data.db'),
    DATA_FILE: path.join(tempDir, 'bot-data.json')
  });

  const result = spawnSync(process.execPath, ['scripts/doctor.js'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /ReferenceError|envNames is not defined/);
  assert.match(output, /fewer than two independent chat providers/i);
});
