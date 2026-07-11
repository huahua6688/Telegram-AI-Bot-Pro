import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { BotDatabase } from '../src/db.js';
import { startHealthServer } from '../src/services/health-server.js';

function logger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function signInitData(botToken, user) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'mini-app-query',
    user: JSON.stringify(user)
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('Mini App securely integrates actions, settings, and memory', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-mini-app-'));
  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();

  const botToken = '123456:test-mini-app-token';
  const telegramUser = {
    id: 88001,
    first_name: 'Mini',
    username: 'mini_user',
    language_code: 'zh-CN'
  };
  const initData = signInitData(botToken, telegramUser);
  const actions = [];
  const memoryClears = [];
  const bot = {
    async handleMiniAppRequest(payload) {
      actions.push(payload);
      return true;
    },
    async clearMiniAppMemory(user) {
      memoryClears.push(user.id);
      return { memoryCount: 2, topicCount: 1 };
    }
  };
  const config = {
    botToken,
    adminUserIds: new Set(),
    aiProvider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    providerModels: { gemini: ['gemini-2.5-flash'] },
    aiProviderFallbackOrder: [],
    maxInputChars: 12000
  };
  const server = startHealthServer({ port: 0, db, config, logger: logger(), bot });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  if (!server.listening) await once(server, 'listening');

  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': initData
  };

  const appResponse = await fetch(`${base}/app`);
  assert.equal(appResponse.status, 200);
  const appHtml = await appResponse.text();
  assert.match(appHtml, /AI 工作台/);
  assert.match(appHtml, /\/api\/miniapp\/action/);
  assert.match(appHtml, /联网搜索/);

  const denied = await fetch(`${base}/api/miniapp/settings`);
  assert.equal(denied.status, 401);

  const invalid = await fetch(`${base}/api/miniapp/action`, {
    method: 'POST',
    headers: { ...headers, 'X-Telegram-Init-Data': `${initData}broken` },
    body: JSON.stringify({ action: 'chat', text: 'hello' })
  });
  assert.equal(invalid.status, 401);

  const settingsResponse = await fetch(`${base}/api/miniapp/settings`, { headers });
  assert.equal(settingsResponse.status, 200);
  const settings = await settingsResponse.json();
  assert.equal(settings.profile.id, String(telegramUser.id));
  assert.ok(settings.providers.some((provider) => provider.id === 'gemini'));

  const action = await fetch(`${base}/api/miniapp/action`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'web', text: 'today news' })
  });
  assert.equal(action.status, 200);
  assert.equal(actions[0].action, 'web');
  assert.equal(actions[0].text, 'today news');
  assert.equal(actions[0].user.id, telegramUser.id);

  const memory = await fetch(`${base}/api/miniapp/memory`, {
    method: 'DELETE',
    headers
  });
  assert.equal(memory.status, 200);
  assert.deepEqual(memoryClears, [telegramUser.id]);
  assert.deepEqual(await memory.json(), {
    ok: true,
    memoryCount: 2,
    topicCount: 1
  });
});
