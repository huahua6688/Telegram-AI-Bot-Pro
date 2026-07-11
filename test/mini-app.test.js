import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { BotDatabase } from '../src/db.js';
import { personaPresets } from '../src/config.js';
import { startHealthServer } from '../src/services/health-server.js';
import { validateTelegramInitData } from '../src/services/mini-app-service.js';

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

test('Mini App validates Telegram identity and integrates settings and actions', async (t) => {
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
  assert.equal(validateTelegramInitData(initData, botToken)?.user?.id, telegramUser.id);
  assert.equal(validateTelegramInitData(`${initData}broken`, botToken), null);

  const actions = [];
  const commandUpdates = [];
  const bot = {
    async handleMiniAppRequest(payload) {
      actions.push(payload);
    },
    async setChatBotCommands(ctx, locale) {
      commandUpdates.push({ chatId: ctx.chat.id, locale });
    }
  };
  const config = {
    miniAppEnabled: true,
    miniAppAuthMaxAgeSeconds: 86400,
    botToken,
    adminUserIds: new Set(),
    availableModels: ['gemini-3.5-flash', 'gemini-2.5-flash'],
    defaultModel: 'gemini-3.5-flash',
    personaPresets,
    enableWebSearch: true,
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
  assert.match(await appResponse.text(), /你的 AI 工作台/);

  const denied = await fetch(`${base}/mini-app/api/bootstrap`);
  assert.equal(denied.status, 401);

  const bootstrap = await fetch(`${base}/mini-app/api/bootstrap`, { headers });
  assert.equal(bootstrap.status, 200);
  const bootstrapPayload = await bootstrap.json();
  assert.equal(bootstrapPayload.user.id, String(telegramUser.id));
  assert.ok(bootstrapPayload.options.personas.some((item) => item.id === 'coder'));

  const settings = await fetch(`${base}/mini-app/api/settings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      persona: 'coder',
      language: 'zh-hant'
    })
  });
  assert.equal(settings.status, 200);
  assert.equal(db.findUser(telegramUser.id)?.persona, 'coder');
  assert.deepEqual(commandUpdates, [{ chatId: telegramUser.id, locale: 'zh-hant' }]);

  const action = await fetch(`${base}/mini-app/api/action`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'web', text: 'today news' })
  });
  assert.equal(action.status, 200);
  assert.equal(actions[0].action, 'web');
  assert.equal(actions[0].text, 'today news');
});
