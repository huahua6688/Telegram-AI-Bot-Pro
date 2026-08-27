import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BotDatabase } from '../src/db.js';
import { classifyModelBilling, extractProviderCost, summarizeBillingCalls, usdToCredits } from '../src/services/model-billing-policy.js';
import { SecretVault } from '../src/services/secret-vault.js';
import { OpenAICompatibleClient } from '../src/services/openai-compatible-client.js';
import { AgentTaskService } from '../src/services/agent-task-service.js';
import { githubAppInternals } from '../src/services/github-app-service.js';

async function databaseFixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paid-agent-db-'));
  const db = new BotDatabase(path.join(dir, 'bot.db'));
  await db.init();
  await db.upsertUser({ id: 42, username: 'payer', first_name: 'Paying' });
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  return db;
}

test('unknown and explicitly paid models cannot use free quota', () => {
  const config = { freeModelPatterns: [':free', 'flash-lite'], paidModelPatterns: ['claude-opus'] };
  assert.equal(classifyModelBilling({ providerId: 'openrouter', model: 'anthropic/claude-opus-4.1', config }), 'paid');
  assert.equal(classifyModelBilling({ providerId: 'openrouter', model: 'vendor/new-unknown', config }), 'paid');
  assert.equal(classifyModelBilling({ providerId: 'openrouter', model: 'vendor/model:free', config }), 'free');
  assert.equal(classifyModelBilling({ providerId: 'gemini', model: 'gemini-2.5-flash-lite', config }), 'free');
});

test('Zeabur header and OpenRouter body cost are normalized', () => {
  const zeabur = extractProviderCost({ id: 'z1', usage: { prompt_tokens: 10, completion_tokens: 5 } }, new Headers({ 'x-litellm-response-cost': '0.1234' }));
  const openrouter = extractProviderCost({ id: 'o1', usage: { cost: 0.25, total_tokens: 20 } });
  const unknown = extractProviderCost({ id: 'u1', usage: { total_tokens: 3 } }, new Headers());
  assert.equal(zeabur.costUsd, 0.1234);
  assert.equal(openrouter.costUsd, 0.25);
  assert.equal(unknown.costUsd, null);
  assert.deepEqual(summarizeBillingCalls([zeabur, openrouter]), {
    calls: [zeabur, openrouter], costKnown: true, actualCostUsd: 0.3734,
    promptTokens: 10, completionTokens: 5, totalTokens: 20
  });
});

test('tool-loop billing includes every provider call', async (t) => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    const payload = call === 1
      ? { id: 'first', choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'get_time', arguments: '{}' } }] } }], usage: { total_tokens: 10 } }
      : { id: 'second', choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { total_tokens: 20 } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json', 'x-litellm-response-cost': call === 1 ? '0.10' : '0.20' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = new OpenAICompatibleClient({ aiBaseUrl: 'https://example.test/v1', aiApiKey: 'key', requestTimeoutMs: 1000, aiMaxToolSteps: 2, temperature: 0 }, {});
  const result = await client.completeWithTools({ model: 'paid', messages: [{ role: 'user', content: 'go' }], tools: [{ type: 'function', function: { name: 'get_time' } }], toolRunner: async () => '{"utc":"now"}' });
  assert.equal(result.text, 'done');
  assert.ok(Math.abs(result.billing.actualCostUsd - 0.3) < 1e-9);
  assert.equal(result.billing.totalTokens, 30);
});

test('unknown provider cost cannot start a second paid tool-loop call', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      id: 'unknown-cost',
      choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'get_time', arguments: '{}' } }] } }],
      usage: { total_tokens: 10 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = new OpenAICompatibleClient({ aiBaseUrl: 'https://example.test/v1', aiApiKey: 'key', requestTimeoutMs: 1000, aiMaxToolSteps: 2, temperature: 0 }, {});
  await assert.rejects(
    client.completeWithTools({
      model: 'unknown-cost-model',
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ type: 'function', function: { name: 'get_time' } }],
      toolRunner: async () => '{"utc":"now"}',
      maxBillingCostUsd: 2
    }),
    (error) => error.code === 'MODEL_COST_UNAVAILABLE_FOR_MULTI_STEP_REQUEST' && error.billing.calls.length === 1
  );
  assert.equal(calls, 1);
});

test('metered usage reserves paid credits and refunds the unused part', async (t) => {
  const db = await databaseFixture(t);
  db.adjustUserCreditBalances('42', { chat: 500 }, { operation: 'set' });
  const reservation = db.reserveUsage({ userId: '42', creditType: 'chat', units: 200, requestKey: 'premium:test', dailyFreeQuota: 999, paidOnly: true, metadata: { metered: true } });
  assert.equal(reservation.record.source, 'paid');
  assert.equal(db.getCreditBalance('42', 'chat').balance, 300);
  const billedCredits = usdToCredits(0.42, { billingUsdPerChatCredit: 0.01, billingCostMarkup: 1.25 });
  const settled = db.settleMeteredUsage(reservation.record.id, { billedCredits, providerId: 'openrouter', modelId: 'claude', costUsd: 0.42, totalTokens: 1000 });
  assert.equal(settled.billedCredits, 53);
  assert.equal(settled.refundedCredits, 147);
  assert.equal(db.getCreditBalance('42', 'chat').balance, 447);
  assert.equal(db.listProviderUsageCosts({ userId: '42' })[0].costUsd, 0.42);
});

test('OAuth state is single-use and GitHub tokens are bound to a user', async (t) => {
  const db = await databaseFixture(t);
  db.createOauthState({ stateHash: 'hash', userId: '42', expiresAt: new Date(Date.now() + 60000).toISOString() });
  assert.equal(db.consumeOauthState({ stateHash: 'hash' }).userId, '42');
  assert.equal(db.consumeOauthState({ stateHash: 'hash' }), null);
  const vault = new SecretVault('a'.repeat(32));
  const encrypted = vault.encrypt('github-token', 'github:42');
  assert.equal(vault.decrypt(encrypted, 'github:42'), 'github-token');
  assert.throws(() => vault.decrypt(encrypted, 'github:43'));
  assert.equal(githubAppInternals.safeRepositoryPath('.github/workflows/test.yml'), '.github/workflows/test.yml');
  assert.throws(() => githubAppInternals.safeRepositoryPath('../../issues'), /INVALID_REPOSITORY_PATH/);
  assert.throws(() => githubAppInternals.safeRepository('owner/repo/issues'), /INVALID_REPOSITORY/);
});

test('active Agent reservations are not swept while waiting for approval', async (t) => {
  const db = await databaseFixture(t);
  db.adjustUserCreditBalances('42', { chat: 100 }, { operation: 'set' });
  const reservation = db.reserveUsage({ userId: '42', creditType: 'chat', units: 50, requestKey: 'agent:test', dailyFreeQuota: 0 });
  const task = db.createAgentTask({ userId: '42', prompt: 'fix tests', repository: 'owner/repo', reservationId: reservation.record.id });
  db.updateAgentTask(task.id, { status: 'waiting_approval' });
  db.createToolApproval({ taskId: task.id, userId: '42', action: 'github_create_branch', expiresAt: new Date(Date.now() + 60000).toISOString() });
  db.db.prepare("UPDATE usage_records SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(reservation.record.id);
  assert.equal(db.refundStaleUsageReservations({ olderThanMs: 60000 }).refunded, 0);
});

test('durable Agent tasks support paused recovery after a bot restart', async (t) => {
  const db = await databaseFixture(t);
  const task = db.createAgentTask({ userId: '42', prompt: 'continue later', repository: 'owner/repo' });
  db.updateAgentTask(task.id, { status: 'running' });
  const service = new AgentTaskService({
    config: { agentWorkerUrl: '', agentWorkerSecret: '' },
    db,
    providerManager: {},
    githubService: {},
    logger: {}
  });
  const recovered = service.recoverInterruptedTasks();
  assert.deepEqual(recovered, { paused: 1, resumed: 0 });
  assert.equal(db.getAgentTask(task.id).status, 'paused');
  assert.match(db.getAgentTask(task.id).error, /restarted/i);
});

test('Agent requires approval before creating a branch and settles its model cost', async (t) => {
  const db = await databaseFixture(t);
  db.adjustUserCreditBalances('42', { chat: 1000 }, { operation: 'set' });
  db.setUserAISettings('42', { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet' });
  const writes = [];
  const github = {
    isConfigured: () => true,
    getConnection: () => ({ connected: true }),
    getToken: async () => 'github-test-token',
    createBranch: async (...args) => { writes.push(args); return { ok: true }; }
  };
  const client = {
    getCapabilities: () => ({ toolCalls: true }),
    chatCompletion: async () => ({
      choices: [{ message: { role: 'assistant', content: 'Task finished.' } }],
      _billingCall: { costUsd: 0.2, promptTokens: 10, completionTokens: 5, totalTokens: 15, providerRequestId: 'req-1' }
    })
  };
  const providerManager = {
    listProviders: () => [{ id: 'openrouter', models: ['anthropic/claude-sonnet'] }],
    selectProvider: () => ({ providerId: 'openrouter', model: 'anthropic/claude-sonnet', client }),
    getClientForProvider: () => client
  };
  const config = {
    agentEnabled: true, agentMaxTaskUsd: 5, agentWorkerUrl: 'https://worker.test', agentWorkerSecret: 's'.repeat(32),
    requestTimeoutMs: 1000, aiMaxToolSteps: 2, aiProvider: 'openrouter', adminUserIds: new Set(),
    billingUsdPerChatCredit: 0.01, billingUsdPerCredit: { chat: 0.01 }, billingCostMarkup: 1.25
  };
  const service = new AgentTaskService({ config, db, providerManager, githubService: github, logger: {} });
  service.worker.prepareRepository = async () => ({ ok: true });
  service.worker.cleanup = async () => ({ ok: true });
  const waiting = await service.start({ userId: '42', repository: 'owner/repo', prompt: 'fix it' });
  assert.equal(waiting.status, 'waiting_approval');
  assert.equal(writes.length, 0);
  const finished = await service.approve({ approvalId: waiting.approval.id, userId: '42', approved: true });
  assert.equal(writes.length, 1);
  assert.equal(finished.status, 'succeeded');
  assert.equal(db.listProviderUsageCosts({ taskId: finished.id })[0].costUsd, 0.2);
});
