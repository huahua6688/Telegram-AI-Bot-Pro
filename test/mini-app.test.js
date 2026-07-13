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

test('Mini App securely exposes settings without chat input actions', async (t) => {
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
  const config = {
    botToken,
    adminUserIds: new Set(),
    aiProvider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    providerModels: { gemini: ['gemini-2.5-flash'] },
    aiProviderFallbackOrder: [],
    maxInputChars: 12000
  };
  const server = startHealthServer({ port: 0, db, config, logger: logger() });

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
  assert.match(appHtml, /我的 AI 设置/);
  assert.doesNotMatch(appHtml, /AI 工作台/);
  assert.doesNotMatch(appHtml, /\/api\/miniapp\/action/);
  assert.doesNotMatch(appHtml, /发送到聊天/);

  const denied = await fetch(`${base}/api/miniapp/settings`);
  assert.equal(denied.status, 401);

  const settingsResponse = await fetch(`${base}/api/miniapp/settings`, { headers });
  assert.equal(settingsResponse.status, 200);
  const settings = await settingsResponse.json();
  assert.equal(settings.profile.id, String(telegramUser.id));
  assert.ok(settings.providers.some((provider) => provider.id === 'gemini'));

  const removedAction = await fetch(`${base}/api/miniapp/action`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'web', text: 'today news' })
  });
  assert.equal(removedAction.status, 404);
});

test('Mini App administrators can set and reset per-user daily quota overrides', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-mini-app-admin-quota-'));
  const db = new BotDatabase(path.join(tempDir, 'bot-data.db'));
  await db.init();

  const botToken = '123456:test-mini-app-admin-quota-token';
  const adminUser = {
    id: 99001,
    first_name: 'Quota Admin',
    username: 'quota_admin',
    language_code: 'zh-CN'
  };
  const targetUser = {
    id: 99002,
    first_name: 'Quota User',
    username: 'quota_user',
    language_code: 'zh-CN'
  };

  await db.upsertUser(targetUser);
  db.setUserDailyUsage(targetUser.id, 3);

  const config = {
    botToken,
    adminUserIds: new Set([String(adminUser.id)]),
    dailyQuota: 25,
    aiProvider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    providerModels: { gemini: ['gemini-2.5-flash'] },
    aiProviderFallbackOrder: [],
    maxInputChars: 12000
  };
  const server = startHealthServer({ port: 0, db, config, logger: logger() });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  if (!server.listening) await once(server, 'listening');

  const base = `http://127.0.0.1:${server.address().port}`;
  const adminHeaders = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': signInitData(botToken, adminUser)
  };
  const userHeaders = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': signInitData(botToken, targetUser)
  };

  const appResponse = await fetch(`${base}/app`);
  const appHtml = await appResponse.text();
  assert.match(appHtml, /全局默认额度/);
  assert.match(appHtml, /保存个人额度/);
  assert.match(appHtml, /恢复全局默认/);

  const forbidden = await fetch(`${base}/api/miniapp/admin/users`, {
    headers: userHeaders
  });
  assert.equal(forbidden.status, 403);

  const usersResponse = await fetch(`${base}/api/miniapp/admin/users?q=99002`, {
    headers: adminHeaders
  });
  assert.equal(usersResponse.status, 200);
  const users = await usersResponse.json();
  const target = users.items.find((user) => user.id === String(targetUser.id));
  assert.ok(target);
  assert.equal(target.dailyUsageCount, 3);
  assert.equal(target.dailyQuota, 25);
  assert.equal(target.dailyQuotaOverride, null);
  assert.equal(target.usesGlobalQuota, true);

  const setResponse = await fetch(`${base}/api/miniapp/admin/users/${targetUser.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ dailyQuota: 7 })
  });
  assert.equal(setResponse.status, 200);
  const setResult = await setResponse.json();
  assert.equal(setResult.user.dailyQuota, 7);
  assert.equal(setResult.user.dailyQuotaOverride, 7);
  assert.equal(setResult.user.usesGlobalQuota, false);
  assert.deepEqual(db.getUserDailyQuota(targetUser.id, config.dailyQuota), {
    userId: String(targetUser.id),
    dailyQuota: 7,
    dailyQuotaOverride: 7,
    usesGlobalQuota: false
  });

  const invalidResponse = await fetch(`${base}/api/miniapp/admin/users/${targetUser.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ dailyQuota: 7.5 })
  });
  assert.equal(invalidResponse.status, 400);
  const invalid = await invalidResponse.json();
  assert.equal(invalid.error, 'INVALID_DAILY_QUOTA');
  assert.equal(db.getUserDailyQuota(targetUser.id, config.dailyQuota).dailyQuota, 7);

  const resetResponse = await fetch(`${base}/api/miniapp/admin/users/${targetUser.id}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ dailyQuota: null })
  });
  assert.equal(resetResponse.status, 200);
  const resetResult = await resetResponse.json();
  assert.equal(resetResult.user.dailyQuota, 25);
  assert.equal(resetResult.user.dailyQuotaOverride, null);
  assert.equal(resetResult.user.usesGlobalQuota, true);

  db.setUserDailyUsage(targetUser.id, 9, '2000-01-01');
  const nextDayResponse = await fetch(`${base}/api/miniapp/admin/users?q=99002`, {
    headers: adminHeaders
  });
  assert.equal(nextDayResponse.status, 200);
  const nextDayUsers = await nextDayResponse.json();
  assert.equal(nextDayUsers.items[0].dailyUsageCount, 0);
});
