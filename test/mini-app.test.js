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
  await db.setConversation(`${telegramUser.id}:${telegramUser.id}:main`, [
    { role: 'user', content: 'private user prompt' },
    { role: 'assistant', content: 'visible assistant reply' }
  ]);
  const config = {
    botToken,
    adminUserIds: new Set(),
    aiProvider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    providerModels: { gemini: ['gemini-2.5-flash'] },
    aiProviderFallbackOrder: [],
    maxInputChars: 12000,
    newsRegion: 'MY',
    newsLanguage: 'auto',
    newsTimeZone: 'Asia/Kuala_Lumpur',
    miniAppShowUserMessages: false
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
  assert.match(appHtml, /新闻地区/);
  assert.match(appHtml, /新闻语言/);
  assert.match(appHtml, /新闻时区/);
  assert.match(appHtml, /list="newsRegionOptions"/);
  assert.match(appHtml, /list="newsLanguageOptions"/);
  assert.match(appHtml, /list="newsTimeZoneOptions"/);
  assert.match(appHtml, /设置语言（Language）/);
  assert.match(appHtml, /获取 AI Hub 最新模型/);
  assert.match(appHtml, /data-admin-pane-target="users"/);
  assert.match(appHtml, /class="bottom-nav"/);
  assert.match(appHtml, /data-view-target="settings"/);
  assert.match(appHtml, /data-view-target="billing"/);
  assert.match(appHtml, /data-view-target="history"/);
  assert.match(appHtml, /id="adminNavButton"/);
  assert.doesNotMatch(appHtml, /XIOMN AI ASSISTANT/);
  assert.doesNotMatch(appHtml, /class="quick-grid"/);
  assert.match(appHtml, /data-admin-pane-target="users"/);
  assert.match(appHtml, /id="adminUserStatus"/);
  assert.match(appHtml, /id="adminUserSort"/);
  assert.match(appHtml, /id="adminUserPrev"/);
  assert.match(appHtml, /id="adminUserNext"/);
  assert.match(appHtml, /id="adminUserSheet"/);
  assert.match(appHtml, /id="adminSessionSearch"/);
  assert.match(appHtml, /id="adminSessionStatus"/);
  assert.match(appHtml, /id="adminSessionPrev"/);
  assert.match(appHtml, /每页 20 人/);
  assert.match(appHtml, /新闻与地区高级设置/);
  assert.match(appHtml, /function switchView\(viewId, options\)/);
  assert.match(appHtml, /disableVerticalSwipes/);
  assert.match(appHtml, /@media \(min-width: 840px\)/);
  assert.match(appHtml, /grid-template-columns: clamp\(188px, 18vw, 224px\) minmax\(0, 1fr\)/);
  assert.match(appHtml, /@media \(max-width: 639px\)/);
  assert.match(appHtml, /@media \(max-height: 560px\) and \(max-width: 839px\)/);
  assert.match(appHtml, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(appHtml, /text-size-adjust: 100%/);
  const inlineScripts = [...appHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim());
  assert.ok(inlineScripts.length > 0);
  assert.doesNotThrow(() => new Function(inlineScripts.at(-1)));

  const denied = await fetch(`${base}/api/miniapp/settings`);
  assert.equal(denied.status, 401);

  const settingsResponse = await fetch(`${base}/api/miniapp/settings`, { headers });
  assert.equal(settingsResponse.status, 200);
  const settings = await settingsResponse.json();
  assert.equal(settings.profile.id, String(telegramUser.id));
  assert.ok(settings.providers.some((provider) => provider.id === 'gemini'));
  assert.deepEqual(settings.news.effective, {
    region: 'CN',
    language: 'zh-CN',
    timeZone: 'Asia/Shanghai'
  });

  const updateResponse = await fetch(`${base}/api/miniapp/settings`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      providerId: 'auto',
      modelId: '',
      fallbackEnabled: true,
      preferredLanguage: 'zh',
      persona: 'default',
      newsRegion: 'SG',
      newsLanguage: 'en-SG',
      newsTimeZone: 'Asia/Singapore'
    })
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.news.region, 'SG');
  assert.equal(updated.news.language, 'en-SG');
  assert.equal(updated.news.timeZone, 'Asia/Singapore');
  assert.deepEqual(updated.news.effective, {
    region: 'SG',
    language: 'en-SG',
    timeZone: 'Asia/Singapore'
  });

  const invalidResponse = await fetch(`${base}/api/miniapp/settings`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      providerId: 'auto',
      modelId: '',
      fallbackEnabled: true,
      preferredLanguage: 'zh',
      persona: 'default',
      newsRegion: 'Singapore',
      newsLanguage: 'en-SG',
      newsTimeZone: 'Mars/Olympus'
    })
  });
  assert.equal(invalidResponse.status, 422);
  assert.equal(db.getUserNewsSettings(telegramUser.id).region, 'SG');

  const customNewsResponse = await fetch(`${base}/api/miniapp/settings`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      providerId: 'auto',
      modelId: '',
      fallbackEnabled: true,
      preferredLanguage: 'zh',
      persona: 'default',
      newsRegion: 'DE',
      newsLanguage: 'de-DE',
      newsTimeZone: 'Europe/Berlin'
    })
  });
  assert.equal(customNewsResponse.status, 200);
  const customNews = await customNewsResponse.json();
  assert.deepEqual(customNews.news.effective, {
    region: 'DE',
    language: 'de-DE',
    timeZone: 'Europe/Berlin'
  });

  const legacyUpdateResponse = await fetch(`${base}/api/miniapp/settings`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      providerId: 'auto',
      modelId: '',
      fallbackEnabled: true,
      preferredLanguage: 'en',
      persona: 'default'
    })
  });
  assert.equal(legacyUpdateResponse.status, 200);
  assert.equal(db.getUserNewsSettings(telegramUser.id).region, 'DE');

  const resetNewsResponse = await fetch(`${base}/api/miniapp/settings`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      providerId: 'auto',
      modelId: '',
      fallbackEnabled: true,
      preferredLanguage: 'en',
      persona: 'default',
      newsRegion: '',
      newsLanguage: '',
      newsTimeZone: ''
    })
  });
  assert.equal(resetNewsResponse.status, 200);
  const resetNews = await resetNewsResponse.json();
  assert.equal(resetNews.news.region, '');
  assert.equal(resetNews.news.language, '');
  assert.equal(resetNews.news.timeZone, '');
  assert.equal(db.getUserNewsSettings(telegramUser.id).region, '');

  const sessionListResponse = await fetch(`${base}/api/miniapp/sessions`, { headers });
  const sessionList = await sessionListResponse.json();
  assert.equal(sessionListResponse.status, 200);
  assert.ok(sessionList.items.length > 0);
  const sessionDetailResponse = await fetch(
    `${base}/api/miniapp/sessions/${encodeURIComponent(sessionList.items[0].id)}`,
    { headers }
  );
  const sessionDetail = await sessionDetailResponse.json();
  assert.equal(sessionDetailResponse.status, 200);
  assert.deepEqual(sessionDetail.messages.map((message) => message.role), ['assistant']);
  assert.equal(JSON.stringify(sessionDetail).includes('private user prompt'), false);
  assert.equal(JSON.stringify(sessionDetail).includes('visible assistant reply'), true);

  const removedAction = await fetch(`${base}/api/miniapp/action`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'web', text: 'today news' })
  });
  assert.equal(removedAction.status, 404);
});

test('Mini App administrators can manage per-user daily quota and paid credit balances', async (t) => {
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
  assert.match(appHtml, /默认免费聊天/);
  assert.match(appHtml, /quotaInput\.dataset\.userQuotaInput/);
  assert.match(appHtml, /resetQuota\.dataset\.userAction = 'reset-quota'/);
  assert.match(appHtml, /已购额度余额/);
  assert.match(appHtml, /保存已购额度/);
  assert.match(appHtml, /不影响每日免费额度/);
  assert.match(appHtml, /购买暂未开放；每日免费额度和已有余额仍可使用/);

  const forbidden = await fetch(`${base}/api/miniapp/admin/users`, {
    headers: userHeaders
  });
  assert.equal(forbidden.status, 403);
  const forbiddenCredits = await fetch(
    `${base}/api/miniapp/admin/users/${targetUser.id}/credits`,
    { headers: userHeaders }
  );
  assert.equal(forbiddenCredits.status, 403);

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
  assert.deepEqual(target.creditBalances, {
    chat: 0,
    vision: 0,
    image_generation: 0,
    tts: 0,
    live_voice: 0,
    video: 0
  });

  const filteredUsersResponse = await fetch(
    `${base}/api/miniapp/admin/users?status=active&sort=usage&limit=1&offset=0`,
    { headers: adminHeaders }
  );
  assert.equal(filteredUsersResponse.status, 200);
  const filteredUsers = await filteredUsersResponse.json();
  assert.equal(filteredUsers.limit, 1);
  assert.equal(filteredUsers.offset, 0);
  assert.ok(filteredUsers.total >= 1);
  assert.equal(filteredUsers.items.length, 1);

  await db.createSession({
    chatId: 'admin-session-chat',
    userId: targetUser.id,
    threadId: 'main',
    name: 'searchable session'
  });
  const sessionsResponse = await fetch(
    `${base}/api/miniapp/admin/sessions?q=quota_user&status=active&sort=recent&limit=1&offset=0`,
    { headers: adminHeaders }
  );
  assert.equal(sessionsResponse.status, 200);
  const sessions = await sessionsResponse.json();
  assert.equal(sessions.total, 1);
  assert.equal(sessions.limit, 1);
  assert.equal(sessions.offset, 0);
  assert.equal(sessions.items[0].userId, String(targetUser.id));

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

  const emptyCreditsResponse = await fetch(
    `${base}/api/miniapp/admin/users/${targetUser.id}/credits`,
    { headers: adminHeaders }
  );
  assert.equal(emptyCreditsResponse.status, 200);
  assert.deepEqual((await emptyCreditsResponse.json()).balances, {
    chat: 0,
    vision: 0,
    image_generation: 0,
    tts: 0,
    live_voice: 0,
    video: 0
  });

  const paidBalances = {
    chat: 50,
    vision: 12,
    image_generation: 8,
    tts: 9,
    live_voice: 4,
    video: 1
  };
  const setCreditsResponse = await fetch(
    `${base}/api/miniapp/admin/users/${targetUser.id}/credits`,
    {
      method: 'PATCH',
      headers: { ...adminHeaders, 'X-Request-Id': 'miniapp-credit-set' },
      body: JSON.stringify({ operation: 'set', balances: paidBalances })
    }
  );
  assert.equal(setCreditsResponse.status, 200);
  const setCredits = await setCreditsResponse.json();
  assert.deepEqual(setCredits.balances, paidBalances);
  assert.deepEqual(db.getUserCreditBalances(targetUser.id).balances, paidBalances);
  assert.equal(db.findUser(targetUser.id).dailyUsageCount, 3);
  assert.equal(db.getUserDailyQuota(targetUser.id, config.dailyQuota).dailyQuota, 7);

  const incompleteCreditsResponse = await fetch(
    `${base}/api/miniapp/admin/users/${targetUser.id}/credits`,
    {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ operation: 'set', balances: { chat: 999 } })
    }
  );
  assert.equal(incompleteCreditsResponse.status, 400);
  assert.equal((await incompleteCreditsResponse.json()).error, 'INCOMPLETE_CREDIT_BALANCES');
  assert.deepEqual(db.getUserCreditBalances(targetUser.id).balances, paidBalances);

  const adjustCreditsResponse = await fetch(
    `${base}/api/miniapp/admin/users/${targetUser.id}/credits`,
    {
      method: 'PATCH',
      headers: { ...adminHeaders, 'X-Request-Id': 'miniapp-credit-adjust' },
      body: JSON.stringify({ operation: 'adjust', adjustments: { chat: -2, video: 3 } })
    }
  );
  assert.equal(adjustCreditsResponse.status, 200);
  const adjustedCredits = await adjustCreditsResponse.json();
  assert.deepEqual(adjustedCredits.balances, {
    ...paidBalances,
    chat: 48,
    video: 4
  });

  const rejectedAdjustmentResponse = await fetch(
    `${base}/api/miniapp/admin/users/${targetUser.id}/credits`,
    {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ operation: 'adjust', adjustments: { video: -5, tts: 20 } })
    }
  );
  assert.equal(rejectedAdjustmentResponse.status, 409);
  assert.equal((await rejectedAdjustmentResponse.json()).error, 'CREDIT_BALANCE_BELOW_ZERO');
  assert.deepEqual(db.getUserCreditBalances(targetUser.id).balances, adjustedCredits.balances);
  assert.equal(db.findUser(targetUser.id).dailyUsageCount, 3);

  const creditAudit = db.listAuditLogs({ action: 'users.credits.set' })[0];
  assert.equal(creditAudit.actorId, String(adminUser.id));
  assert.equal(creditAudit.targetId, String(targetUser.id));
  assert.equal(creditAudit.requestId, 'miniapp-credit-set');
  assert.deepEqual(creditAudit.details.afterBalances, paidBalances);

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
