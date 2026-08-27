import { AgentWorkerClient } from './agent-worker-client.js';
import { getPremiumReservationUnits, usdToCredits } from './model-billing-policy.js';
import { randomUUID } from 'node:crypto';

const TOOLS = [
  { type: 'function', function: { name: 'github_get_file', description: 'Read one file from the connected GitHub repository.', parameters: { type: 'object', properties: { path: { type: 'string' }, ref: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'github_list_tree', description: 'List files in the connected GitHub repository.', parameters: { type: 'object', properties: { ref: { type: 'string' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'sandbox_run', description: 'Run tests or a command in the isolated worker. No network is available.', parameters: { type: 'object', properties: { command: { type: 'array', items: { type: 'string' } }, files: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['command'], additionalProperties: false } } },
  { type: 'function', function: { name: 'github_put_file', description: 'Create or update a file on a task branch. Requires user approval.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, message: { type: 'string' }, sha: { type: 'string' } }, required: ['path', 'content', 'message'], additionalProperties: false } } },
  { type: 'function', function: { name: 'github_create_pr', description: 'Create a pull request from the task branch. Requires user approval.', parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, base: { type: 'string' } }, required: ['title', 'base'], additionalProperties: false } } }
];

function json(value) { return JSON.stringify(value); }
function parseArgs(call) { try { return JSON.parse(call.function?.arguments || '{}'); } catch { throw new Error('AGENT_TOOL_ARGS_INVALID'); } }
function knownCost(calls = []) {
  return calls.length > 0 && calls.every((call) => Number.isFinite(call.costUsd))
    ? calls.reduce((sum, call) => sum + Number(call.costUsd), 0)
    : null;
}

export class AgentTaskService {
  constructor({ config, db, providerManager, githubService, logger }) {
    this.config = config;
    this.db = db;
    this.providerManager = providerManager;
    this.github = githubService;
    this.logger = logger;
    this.worker = new AgentWorkerClient({ baseUrl: config.agentWorkerUrl, secret: config.agentWorkerSecret, timeoutMs: config.requestTimeoutMs });
    this.activeRuns = new Map();
    this.notifier = null;
  }

  setNotifier(notifier) {
    this.notifier = typeof notifier === 'function' ? notifier : null;
  }

  async notify(task) {
    if (!this.notifier || !task?.chatId) return;
    try {
      await this.notifier(task);
    } catch (error) {
      this.logger?.warn?.('Agent Telegram notification failed', { taskId: task?.id, error: error.message });
    }
  }

  enqueue(taskId, resumedToolResult = null) {
    let task = this.db.getAgentTask(taskId);
    if (!task) throw new Error('AGENT_TASK_NOT_FOUND');
    if (resumedToolResult) {
      const state = task.result || {};
      const messages = Array.isArray(state.messages) ? [...state.messages, resumedToolResult] : [resumedToolResult];
      task = this.db.updateAgentTask(taskId, { status: 'queued', result: { ...state, messages } });
    } else {
      task = this.db.updateAgentTask(taskId, { status: 'queued' });
    }
    setImmediate(() => {
      this.run(taskId)
        .then((finished) => this.notify(finished))
        .catch((error) => this.logger?.error?.('Background Agent task crashed', { taskId, error: error.message }));
    });
    return task;
  }

  isConfigured() {
    return Boolean(this.config.agentEnabled && getPremiumReservationUnits(this.config, 'chat', this.config.agentMaxTaskUsd) && this.github?.isConfigured() && this.worker.isConfigured());
  }

  async start({ userId, chatId = '', prompt, repository, baseBranch = 'main' }) {
    if (!this.isConfigured()) throw new Error('AGENT_NOT_CONFIGURED');
    if (!this.github.getConnection(userId)) throw new Error('GITHUB_NOT_CONNECTED');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || ''))) throw new Error('INVALID_REPOSITORY');
    if (!String(prompt || '').trim() || String(prompt).length > 20_000) throw new Error('INVALID_AGENT_PROMPT');
    const units = getPremiumReservationUnits(this.config, 'chat', this.config.agentMaxTaskUsd);
    const userSettings = this.db.getUserAISettings?.(userId) || {};
    const selectedModel = String(userSettings.modelId || '');
    let selectedProvider = String(userSettings.providerId || '');
    if (!selectedProvider || selectedProvider === 'auto') {
      selectedProvider = selectedModel
        ? this.providerManager.listProviders().find((provider) => provider.models.includes(selectedModel))?.id || ''
        : '';
    }
    const reservation = this.db.reserveUsage({ userId, creditType: 'chat', units, requestKey: `agent:${userId}:${randomUUID()}`, dailyFreeQuota: 0, paidOnly: true, isAdmin: this.config.adminUserIds?.has(String(userId)) || false, metadata: { kind: 'agent', repository } });
    if (!reservation.allowed) throw new Error(reservation.reason || 'INSUFFICIENT_CREDITS');
    const branch = `ai/task-${Date.now().toString(36)}`;
    const task = this.db.createAgentTask({ userId, chatId, prompt, repository, branch, reservationId: reservation.record.id, providerId: selectedProvider, modelId: selectedModel });
    const approval = this.db.createToolApproval({ taskId: task.id, userId, action: 'github_create_branch', payload: { args: { branch, baseBranch }, toolCallId: 'initial-branch' }, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() });
    this.db.updateAgentTask(task.id, { status: 'waiting_approval', result: { messages: [], billingCalls: [], approvalId: approval.id } });
    return { ...this.db.getAgentTask(task.id), approval };
  }

  async run(taskId, resumedToolResult = null) {
    const key = String(taskId);
    if (this.activeRuns.has(key)) return this.db.getAgentTask(taskId);
    const current = this.db.getAgentTask(taskId);
    if (!current || ['paused', 'cancelled', 'failed', 'succeeded', 'waiting_approval'].includes(current.status)) return current;
    const controller = new AbortController();
    this.activeRuns.set(key, controller);
    try {
      return await this.runInternal(taskId, resumedToolResult, controller.signal);
    } catch (error) {
      const task = this.db.getAgentTask(taskId);
      if (!task || ['paused', 'cancelled', 'failed', 'succeeded'].includes(task.status)) return task;
      const calls = Array.isArray(task.result?.billingCalls) ? task.result.billingCalls : [];
      if (calls.length > 0) this.settle(task, calls, { providerId: task.providerId, model: task.modelId });
      else this.db.refundUsage(task.reservationId);
      const failed = this.db.updateAgentTask(taskId, { status: 'failed', error: error.message });
      await this.cleanupWorkspace(taskId);
      return failed;
    } finally {
      this.activeRuns.delete(key);
    }
  }

  async runInternal(taskId, resumedToolResult = null, signal = null) {
    let task = this.db.getAgentTask(taskId);
    if (!task) throw new Error('AGENT_TASK_NOT_FOUND');
    const selection = this.providerManager.selectProvider({ capability: 'chat', preferredProvider: task.providerId || this.config.aiProvider, fallbackEnabled: !task.providerId });
    if (!selection) throw new Error('NO_USABLE_AI_PROVIDER');
    if (task.modelId) {
      selection.model = task.modelId;
      selection.client = this.providerManager.getClientForProvider(selection.providerId, task.modelId);
    }
    const capabilities = selection.client.getCapabilities?.() || {};
    if (!capabilities.toolCalls) throw new Error('AGENT_MODEL_REQUIRES_TOOL_CALLING');
    const state = task.result || {};
    const messages = Array.isArray(state.messages) && state.messages.length > 0 ? state.messages : [
      { role: 'system', content: 'You are a coding agent. Inspect the repository with tools, make focused changes, run tests in the isolated worker when available, and create a pull request. Never claim a write happened until its tool succeeds.' },
      { role: 'user', content: `Repository: ${task.repository}\nTask: ${task.prompt}\nTask branch: ${task.branch}` }
    ];
    const billingCalls = Array.isArray(state.billingCalls) ? state.billingCalls : [];
    if (resumedToolResult) messages.push(resumedToolResult);
    task = this.db.updateAgentTask(taskId, { status: 'running', providerId: selection.providerId, modelId: selection.model });

    try {
      const pendingApprovedAction = state.pendingApprovedAction;
      if (pendingApprovedAction?.action) {
        const content = await this.executeTool(task, pendingApprovedAction.action, pendingApprovedAction.args || {}, signal);
        if (pendingApprovedAction.action === 'github_create_branch') {
          await this.worker.prepareRepository({
            taskId: task.id,
            repository: task.repository,
            ref: task.branch,
            token: await this.github.getToken(task.userId),
            installDependencies: true
          }, { signal });
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: pendingApprovedAction.toolCallId,
            content
          });
        }
        delete state.pendingApprovedAction;
        this.db.updateAgentTask(taskId, { status: 'running', result: { ...state, messages, billingCalls } });
      }
      for (let step = 0; step < Math.max(2, Number(this.config.aiMaxToolSteps) || 3) * 3; step += 1) {
        const runtimeMs = Date.now() - Date.parse(task.startedAt || new Date().toISOString());
        if (runtimeMs > Math.max(1, Number(this.config.agentMaxRuntimeMinutes) || 60) * 60_000) {
          throw new Error('AGENT_RUNTIME_LIMIT_REACHED');
        }
        const response = await selection.client.chatCompletion({ model: selection.model, messages, tools: TOOLS, requestTimeoutMs: this.config.requestTimeoutMs, signal });
        const usage = response?.usage || {};
        billingCalls.push(response?._billingCall || {
          costUsd: null,
          promptTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
          completionTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
          totalTokens: Number(usage.total_tokens ?? 0) || 0,
          providerRequestId: String(response?.id || '')
        });
        const assistant = response.choices?.[0]?.message;
        if (!assistant) throw new Error('AI provider returned an empty agent response.');
        messages.push({ role: 'assistant', content: assistant.content || '', tool_calls: assistant.tool_calls });
        if (!assistant.tool_calls?.length) {
          const result = { text: String(assistant.content || ''), messages, billingCalls };
          this.settle(task, billingCalls, selection);
          const finished = this.db.updateAgentTask(taskId, { status: 'succeeded', result });
          await this.cleanupWorkspace(taskId);
          return finished;
        }
        if (billingCalls.some((call) => !Number.isFinite(call.costUsd))) {
          throw new Error('AGENT_PROVIDER_COST_UNAVAILABLE_FOR_MULTI_STEP_TASK');
        }
        const spent = knownCost(billingCalls);
        if (spent != null && spent >= Number(this.config.agentMaxTaskUsd || 0)) {
          throw new Error('AGENT_COST_LIMIT_REACHED');
        }
        for (let callIndex = 0; callIndex < assistant.tool_calls.length; callIndex += 1) {
          const call = assistant.tool_calls[callIndex];
          const args = parseArgs(call);
          if (['github_put_file', 'github_create_pr'].includes(call.function.name)) {
            for (const deferred of assistant.tool_calls.slice(callIndex + 1)) {
              messages.push({ role: 'tool', tool_call_id: deferred.id, content: json({ ok: false, deferred: true, message: 'Request this action again after the current approval.' }) });
            }
            const approval = this.db.createToolApproval({ taskId, userId: task.userId, action: call.function.name, payload: { args, toolCallId: call.id }, expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() });
            this.db.updateAgentTask(taskId, { status: 'waiting_approval', result: { messages, billingCalls, approvalId: approval.id } });
            return { ...this.db.getAgentTask(taskId), approval };
          }
          const content = await this.executeTool(task, call.function.name, args, signal);
          messages.push({ role: 'tool', tool_call_id: call.id, content });
        }
        this.db.updateAgentTask(taskId, { status: 'running', result: { messages, billingCalls } });
      }
      throw new Error('AGENT_STEP_LIMIT_REACHED');
    } catch (error) {
      if (Array.isArray(error?.billing?.calls)) billingCalls.push(...error.billing.calls);
      const latest = this.db.getAgentTask(taskId);
      if (['paused', 'cancelled'].includes(latest?.status)) return latest;
      if (billingCalls.length > 0) {
        this.settle(task, billingCalls, selection);
      } else {
        this.db.refundUsage(task.reservationId);
      }
      const failed = this.db.updateAgentTask(taskId, { status: 'failed', error: error.message, result: { messages, billingCalls } });
      await this.cleanupWorkspace(taskId);
      return failed;
    }
  }

  async approve({ approvalId, userId, approved, background = false }) {
    const approval = this.db.decideToolApproval(approvalId, userId, approved);
    if (!approval) throw new Error('APPROVAL_INVALID_OR_EXPIRED');
    const task = this.db.getAgentTask(approval.taskId);
    if (!approved) {
      const calls = Array.isArray(task.result?.billingCalls) ? task.result.billingCalls : [];
      if (calls.length > 0) {
        this.settle(task, calls, { providerId: task.providerId, model: task.modelId });
      } else {
        this.db.refundUsage(task.reservationId);
      }
      const cancelled = this.db.updateAgentTask(task.id, { status: 'cancelled', error: 'User rejected the requested GitHub write.' });
      await this.cleanupWorkspace(task.id);
      return cancelled;
    }
    const state = task.result || {};
    this.db.updateAgentTask(task.id, {
      status: 'queued',
      error: '',
      result: {
        ...state,
        pendingApprovedAction: {
          action: approval.action,
          args: approval.payload.args || {},
          toolCallId: approval.payload.toolCallId || ''
        }
      }
    });
    return background
      ? this.enqueue(task.id)
      : this.run(task.id);
  }

  getOwnedTask(taskId, userId) {
    const task = this.db.getAgentTask(taskId);
    if (!task || String(task.userId) !== String(userId)) throw new Error('AGENT_TASK_NOT_FOUND');
    return task;
  }

  pause({ taskId, userId }) {
    const task = this.getOwnedTask(taskId, userId);
    if (!['queued', 'running'].includes(task.status)) throw new Error('AGENT_TASK_NOT_PAUSABLE');
    const paused = this.db.updateAgentTask(taskId, { status: 'paused', error: 'Paused by user.' });
    this.activeRuns.get(String(taskId))?.abort?.(new Error('AGENT_PAUSED'));
    return paused;
  }

  resume({ taskId, userId }) {
    const task = this.getOwnedTask(taskId, userId);
    if (task.status !== 'paused') throw new Error('AGENT_TASK_NOT_PAUSED');
    if (this.activeRuns.has(String(taskId))) throw new Error('AGENT_TASK_STILL_STOPPING');
    this.db.updateAgentTask(taskId, { status: 'queued', error: '' });
    return this.enqueue(taskId);
  }

  async cancel({ taskId, userId }) {
    const task = this.getOwnedTask(taskId, userId);
    if (['succeeded', 'failed', 'cancelled'].includes(task.status)) return task;
    const cancelled = this.db.updateAgentTask(taskId, { status: 'cancelled', error: 'Cancelled by user.' });
    this.activeRuns.get(String(taskId))?.abort?.(new Error('AGENT_CANCELLED'));
    const calls = Array.isArray(task.result?.billingCalls) ? task.result.billingCalls : [];
    if (calls.length > 0) this.settle(task, calls, { providerId: task.providerId, model: task.modelId });
    else this.db.refundUsage(task.reservationId);
    await this.cleanupWorkspace(taskId);
    return cancelled;
  }

  recoverInterruptedTasks() {
    const interrupted = this.db.listAgentTasks?.({ statuses: ['running'], limit: 100 }) || [];
    for (const task of interrupted) {
      this.db.updateAgentTask(task.id, {
        status: 'paused',
        error: 'Bot restarted while this task was running. Resume it to avoid an unapproved duplicate model call.'
      });
    }
    const queued = this.db.listAgentTasks?.({ statuses: ['queued'], limit: 100 }) || [];
    for (const task of queued) this.enqueue(task.id);
    return { paused: interrupted.length, resumed: queued.length };
  }

  async executeTool(task, name, args, signal = null) {
    if (name === 'github_get_file') return json(await this.github.getFile(task.userId, task.repository, args.path, args.ref || task.branch));
    if (name === 'github_create_branch') return json(await this.github.createBranch(task.userId, task.repository, args.branch, `heads/${args.baseBranch}`));
    if (name === 'github_list_tree') {
      const token = await this.github.getToken(task.userId);
      const timeout = AbortSignal.timeout(15000);
      const response = await fetch(`https://api.github.com/repos/${task.repository}/git/trees/${encodeURIComponent(args.ref || task.branch)}?recursive=1`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Telegram-AI-Bot-Pro' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!response.ok) throw new Error(`GitHub tree request failed (${response.status})`);
      const data = await response.json();
      return json((data.tree || []).filter((item) => item.type === 'blob').slice(0, 1000).map((item) => ({ path: item.path, sha: item.sha, size: item.size })));
    }
    if (name === 'sandbox_run') return json(await this.worker.run({ taskId: task.id, command: args.command, files: args.files || {} }, { signal }));
    if (name === 'github_put_file') {
      const result = await this.github.putFile(task.userId, task.repository, args.path, { branch: task.branch, message: args.message, content: args.content, sha: args.sha || '' });
      await this.worker.writeFiles({ taskId: task.id, files: { [args.path]: args.content } });
      return json(result);
    }
    if (name === 'github_create_pr') return json(await this.github.createPullRequest(task.userId, task.repository, { title: args.title, body: args.body || '', head: task.branch, base: args.base }));
    throw new Error(`AGENT_TOOL_NOT_FOUND:${name}`);
  }

  settle(task, calls, selection) {
    const costUsd = knownCost(calls);
    const known = costUsd != null;
    const reserved = this.db.getUsageRecord(task.reservationId)?.units || 1;
    const billedCredits = known ? Math.min(reserved, usdToCredits(costUsd, this.config) || reserved) : reserved;
    const tokens = calls.reduce((sum, call) => sum + Number(call.totalTokens || 0), 0);
    const result = this.db.settleMeteredUsage(task.reservationId, { billedCredits, providerId: selection.providerId, modelId: selection.model, taskId: task.id, costUsd, totalTokens: tokens, metadata: { kind: 'agent', costKnown: known, calls: calls.length } });
    if (!result.settled && !result.duplicate) throw new Error(result.reason || 'AGENT_BILLING_SETTLEMENT_FAILED');
  }

  async cleanupWorkspace(taskId) {
    try {
      await this.worker.cleanup({ taskId });
    } catch (error) {
      this.logger?.warn?.('Agent workspace cleanup failed', { taskId, error: error.message });
    }
  }
}
