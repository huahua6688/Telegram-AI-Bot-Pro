import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { normalizeLanguageCode } from './utils/telegram.js';

// Schema version history:
// v1: Core bot tables (users/chats/conversations/stats/favorites)
// v2: Structured session/message/prompt history and favorites target migration
// v3: RBAC, feature flags, policy rules, provider/model configs, admin audit logs
// v4: Long-term memory, topic states, active context
// v5: Per-user AI provider/model settings and provider fallback preference
// v6: Per-user daily quota overrides
// v7: Telegram Stars orders, per-capability balances, usage reservations, and refunds
// v8: Single-owner leases for Telegram Stars refund attempts
const CURRENT_SCHEMA_VERSION = 8;

export const BILLING_CREDIT_TYPES = Object.freeze([
  'chat',
  'vision',
  'image_generation',
  'tts',
  'live_voice',
  'video'
]);

const BILLING_CREDIT_TYPE_SET = new Set(BILLING_CREDIT_TYPES);
const BILLING_CREDIT_TYPE_ALIASES = new Map([
  ['image', 'image_generation'],
  ['image_edit', 'image_generation'],
  ['image_editing', 'image_generation'],
  ['image_understanding', 'vision'],
  ['image_recognition', 'vision'],
  ['voice', 'live_voice'],
  ['realtime_voice', 'live_voice'],
  ['speech_transcription', 'live_voice'],
  ['speech_synthesis', 'tts']
]);

const defaultData = {
  meta: {
    createdAt: null,
    updatedAt: null
  },
  users: [],
  chats: [],
  conversations: [],
  stats: {
    messagesHandled: 0,
    aiCalls: 0,
    toolCalls: 0,
    voiceTranscriptions: 0,
    imageGenerations: 0,
    ttsGenerations: 0,
    startedAt: null
  }
};

const userColumns = {
  username: 'username',
  firstName: 'first_name',
  lastName: 'last_name',
  isAdmin: 'is_admin',
  isBlocked: 'is_blocked',
  isAllowed: 'is_allowed',
  preferredModel: 'preferred_model',
  preferredLanguage: 'preferred_language',
  persona: 'persona',
  customSystemPrompt: 'custom_system_prompt',
  dailyUsageDate: 'daily_usage_date',
  dailyUsageCount: 'daily_usage_count',
  totalMessages: 'total_messages',
  lastSeenAt: 'last_seen_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at'
};

const chatColumns = {
  type: 'type',
  title: 'title',
  username: 'username',
  triggerMode: 'trigger_mode',
  keyword: 'keyword',
  defaultModel: 'default_model',
  systemPrompt: 'system_prompt',
  createdAt: 'created_at',
  updatedAt: 'updated_at'
};

function now() {
  return new Date().toISOString();
}

function toBoolean(value) {
  return Boolean(value);
}

function toIntegerBoolean(value) {
  return value ? 1 : 0;
}

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeBillingCreditType(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const resolved = BILLING_CREDIT_TYPE_ALIASES.get(normalized) || normalized;
  if (!BILLING_CREDIT_TYPE_SET.has(resolved)) {
    throw new RangeError(`Unsupported billing credit type: ${String(value || '')}`);
  }
  return resolved;
}

function normalizeBillingUnits(value, { allowZero = false, label = 'Billing units' } = {}) {
  const units = Number(value);
  if (!Number.isSafeInteger(units) || units < (allowZero ? 0 : 1)) {
    throw new RangeError(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer.`);
  }
  return units;
}

function normalizeCreditGrants(grants = {}) {
  const normalized = {};
  for (const [rawType, rawUnits] of Object.entries(parseJsonObject(grants))) {
    const creditType = normalizeBillingCreditType(rawType);
    const units = normalizeBillingUnits(rawUnits, { allowZero: true, label: `Grant for ${creditType}` });
    if (units > 0) normalized[creditType] = (normalized[creditType] || 0) + units;
  }
  return normalized;
}

function createCreditBalanceError(code, message) {
  const error = new RangeError(message);
  error.code = code;
  return error;
}

function normalizeCreditBalanceValues(values, { allowNegative = false, requireAll = false } = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw createCreditBalanceError(
      'INVALID_CREDIT_BALANCES',
      'Credit balances must be provided as an object.'
    );
  }

  const normalized = {};
  for (const [rawType, rawValue] of Object.entries(values)) {
    const creditType = normalizeBillingCreditType(rawType);
    if (Object.prototype.hasOwnProperty.call(normalized, creditType)) {
      throw createCreditBalanceError(
        'DUPLICATE_CREDIT_TYPE',
        `Credit type ${creditType} was provided more than once.`
      );
    }
    if (
      typeof rawValue !== 'number' ||
      !Number.isSafeInteger(rawValue) ||
      (!allowNegative && rawValue < 0)
    ) {
      throw createCreditBalanceError(
        'INVALID_CREDIT_BALANCE',
        `${creditType} must be ${allowNegative ? 'a safe integer' : 'a non-negative safe integer'}.`
      );
    }
    normalized[creditType] = rawValue;
  }

  if (Object.keys(normalized).length === 0) {
    throw createCreditBalanceError(
      'INVALID_CREDIT_BALANCES',
      'At least one credit balance is required.'
    );
  }
  if (requireAll && BILLING_CREDIT_TYPES.some((creditType) => !(creditType in normalized))) {
    throw createCreditBalanceError(
      'INCOMPLETE_CREDIT_BALANCES',
      'All billing credit types are required.'
    );
  }
  return normalized;
}

function rowToStarOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    invoicePayload: row.invoice_payload,
    userId: row.user_id,
    productId: row.product_id,
    currency: row.currency,
    amount: Number(row.amount || 0),
    grants: normalizeCreditGrants(row.grants_json),
    status: row.status,
    telegramPaymentChargeId: row.telegram_payment_charge_id || '',
    providerPaymentChargeId: row.provider_payment_charge_id || '',
    createdAt: row.created_at || '',
    expiresAt: row.expires_at || '',
    paidAt: row.paid_at || '',
    refundedAt: row.refunded_at || '',
    updatedAt: row.updated_at || ''
  };
}

function rowToUsageRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestKey: row.request_key,
    userId: row.user_id,
    creditType: row.credit_type,
    units: Number(row.units || 0),
    source: row.source,
    status: row.status,
    balanceBefore: Number(row.balance_before || 0),
    balanceAfter: Number(row.balance_after || 0),
    usageDate: row.usage_date || '',
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function rowToStarRefund(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    telegramPaymentChargeId: row.telegram_payment_charge_id,
    status: row.status,
    requestedBy: row.requested_by || '',
    reason: row.reason || '',
    error: row.error || '',
    revokedGrants: normalizeCreditGrants(row.revoked_grants_json),
    leaseToken: row.lease_token || '',
    leaseExpiresAt: row.lease_expires_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function rowToUser(row) {
  if (!row) return undefined;
  const dailyUsageDate = row.daily_usage_date || '';
  const currentUsageDate = new Date().toISOString().slice(0, 10);
  return {
    id: row.id,
    username: row.username || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    isAdmin: toBoolean(row.is_admin),
    isBlocked: toBoolean(row.is_blocked),
    isAllowed: toBoolean(row.is_allowed),
    preferredModel: row.preferred_model || '',
    preferredLanguage: row.preferred_language || 'zh',
    persona: row.persona || 'default',
    customSystemPrompt: row.custom_system_prompt || '',
    dailyUsageDate,
    dailyUsageCount: dailyUsageDate === currentUsageDate ? row.daily_usage_count || 0 : 0,
    dailyQuotaOverride: row.daily_quota_override == null ? null : Number(row.daily_quota_override),
    totalMessages: row.total_messages || 0,
    lastSeenAt: row.last_seen_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function rowToChat(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    type: row.type || '',
    title: row.title || '',
    username: row.username || '',
    triggerMode: row.trigger_mode || 'smart',
    keyword: row.keyword || 'ai',
    defaultModel: row.default_model || '',
    systemPrompt: row.system_prompt || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    userId: row.user_id,
    threadId: row.thread_id || 'main',
    name: row.name || 'main',
    status: row.status || 'active',
    isDefault: toBoolean(row.is_default),
    lastAccessedAt: row.last_accessed_at || row.updated_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function parseLegacyData(content) {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.users) || !Array.isArray(parsed.chats) || !Array.isArray(parsed.conversations)) {
      return null;
    }
    return {
      ...structuredClone(defaultData),
      ...parsed,
      meta: { ...structuredClone(defaultData.meta), ...(parsed.meta || {}) },
      stats: { ...structuredClone(defaultData.stats), ...(parsed.stats || {}) }
    };
  } catch {
    return null;
  }
}

function mapPatchToColumns(patch, columnMap) {
  return Object.entries(patch)
    .filter(([key, value]) => columnMap[key] && value !== undefined)
    .map(([key, value]) => [columnMap[key], value]);
}

function parseSessionIdentity(sessionId = '') {
  const [chatId = '', userId = '', threadId = 'main'] = String(sessionId).split(':');
  return {
    chatId: chatId || '',
    userId: userId || '',
    threadId: threadId || 'main'
  };
}

function createMessageId(sessionId, sequence) {
  return `msg:${sessionId}:${sequence}`;
}

function createVersionId(messageId, version) {
  return `${messageId}:v${version}`;
}

function normalizeFavoriteTarget({ targetType = 'message', targetId = '', promptId = '', messageVersionId = '', messageId = '' }) {
  const resolvedType = targetType || 'message';
  if (resolvedType === 'prompt') {
    return {
      targetType: 'prompt',
      targetId: String(targetId || promptId || ''),
      promptId: String(promptId || targetId || ''),
      messageVersionId: '',
      messageId: ''
    };
  }
  if (resolvedType === 'message_version') {
    return {
      targetType: 'message_version',
      targetId: String(targetId || messageVersionId || ''),
      promptId: '',
      messageVersionId: String(messageVersionId || targetId || ''),
      messageId: String(messageId || '')
    };
  }
  return {
    targetType: 'message',
    targetId: String(targetId || messageId || ''),
    promptId: '',
    messageVersionId: '',
    messageId: String(messageId || targetId || '')
  };
}

export class BotDatabase {
  constructor(filePath, legacyFilePath = '') {
    this.filePath = filePath;
    this.legacyFilePath = legacyFilePath && legacyFilePath !== filePath ? legacyFilePath : '';
    this.db = null;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    await this.importLegacyJsonIfNeeded();
    this.runMigrations();

    this.setMeta('createdAt', this.getMeta('createdAt') || now());
    this.setMeta('updatedAt', now());
    this.ensureStatsRow(this.getStats().startedAt || now());
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  runMigrations() {
    const currentVersion = Number.parseInt(this.getMeta('schemaVersion') || '0', 10) || 0;
    for (let version = currentVersion + 1; version <= CURRENT_SCHEMA_VERSION; version += 1) {
      if (version === 1) {
        this.applySchemaV1();
      }
      if (version === 2) {
        this.applySchemaV2();
      }
      if (version === 3) {
        this.applySchemaV3();
      }
      if (version === 4) {
        this.applySchemaV4();
      }
      if (version === 5) {
        this.applySchemaV5();
      }
      if (version === 6) {
        this.applySchemaV6();
      }
      if (version === 7) {
        this.applySchemaV7();
      }
      if (version === 8) {
        this.applySchemaV8();
      }
      this.setMeta('schemaVersion', String(version));
    }
  }

  applySchemaV1() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL DEFAULT '',
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_blocked INTEGER NOT NULL DEFAULT 0,
        is_allowed INTEGER NOT NULL DEFAULT 0,
        preferred_model TEXT NOT NULL DEFAULT '',
        preferred_language TEXT NOT NULL DEFAULT 'zh',
        persona TEXT NOT NULL DEFAULT 'default',
        custom_system_prompt TEXT NOT NULL DEFAULT '',
        daily_usage_date TEXT NOT NULL DEFAULT '',
        daily_usage_count INTEGER NOT NULL DEFAULT 0,
        total_messages INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        username TEXT NOT NULL DEFAULT '',
        trigger_mode TEXT NOT NULL DEFAULT 'smart',
        keyword TEXT NOT NULL DEFAULT 'ai',
        default_model TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        session_id TEXT PRIMARY KEY,
        messages_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        messages_handled INTEGER NOT NULL DEFAULT 0,
        ai_calls INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        voice_transcriptions INTEGER NOT NULL DEFAULT 0,
        image_generations INTEGER NOT NULL DEFAULT 0,
        tts_generations INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        text TEXT NOT NULL,
        source_text TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        locale TEXT NOT NULL DEFAULT 'zh',
        created_at TEXT NOT NULL,
        UNIQUE(chat_id, user_id, message_id)
      );
    `);
  }

  applySchemaV2() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        thread_id TEXT NOT NULL DEFAULT 'main',
        name TEXT NOT NULL DEFAULT 'main',
        status TEXT NOT NULL DEFAULT 'active',
        is_default INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        parent_message_id TEXT,
        active_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        source TEXT NOT NULL DEFAULT 'chat',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(session_id, sequence),
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(parent_message_id) REFERENCES messages(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS message_versions (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        prompt_snapshot_json TEXT NOT NULL DEFAULT '',
        context_snapshot_json TEXT NOT NULL DEFAULT '',
        is_current INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(message_id, version),
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS prompts (
        id TEXT PRIMARY KEY,
        prompt_key TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        parent_prompt_id TEXT,
        owner_user_id TEXT NOT NULL DEFAULT '',
        chat_id TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'user',
        kind TEXT NOT NULL DEFAULT 'system',
        name TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(parent_prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user_chat ON sessions(user_id, chat_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_last_accessed ON sessions(last_accessed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_session_sequence ON messages(session_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_messages_session_role ON messages(session_id, role, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_message_versions_message_current ON message_versions(message_id, is_current, version DESC);
      CREATE INDEX IF NOT EXISTS idx_prompts_scope_owner ON prompts(scope, owner_user_id, chat_id, session_id, is_active, updated_at DESC);
    `);

    this.ensureFavoritesV2Columns();
    this.backfillFavoritesTargets();
    this.migrateConversationsToStructuredHistory();
  }

  applySchemaV3() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        is_system INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT NOT NULL,
        permission_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(role_id, permission_id),
        FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
        FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, role_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS feature_flags (
        id TEXT PRIMARY KEY,
        flag_key TEXT NOT NULL,
        scope_type TEXT NOT NULL DEFAULT 'global',
        scope_id TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS policy_rules (
        id TEXT PRIMARY KEY,
        effect TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT NOT NULL DEFAULT '',
        actor_type TEXT NOT NULL DEFAULT 'system',
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL DEFAULT 'ok',
        request_id TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_configs (
        provider_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        meta_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_configs (
        model_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        meta_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feature_flags_lookup ON feature_flags(flag_key, scope_type, scope_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_policy_rules_lookup ON policy_rules(effect, subject_type, subject_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_logs(actor_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_status_updated ON sessions(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_users_usage ON users(daily_usage_date, daily_usage_count DESC);
      CREATE INDEX IF NOT EXISTS idx_message_versions_model ON message_versions(model, created_at DESC);
    `);
    this.seedAccessControlDefaults();
  }

  applySchemaV4() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        chat_id TEXT NOT NULL DEFAULT '',
        topic_id TEXT NOT NULL DEFAULT '',
        memory_type TEXT NOT NULL DEFAULT 'fact',
        key TEXT NOT NULL DEFAULT '',
        value TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        source TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS topic_states (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        chat_id TEXT NOT NULL DEFAULT '',
        topic_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        current_goal TEXT NOT NULL DEFAULT '',
        last_step TEXT NOT NULL DEFAULT '',
        next_step TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        last_accessed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS active_contexts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        chat_id TEXT NOT NULL DEFAULT '',
        active_topic_id TEXT NOT NULL DEFAULT '',
        return_topic_id TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_lookup ON memory_items(user_id, chat_id, topic_id, memory_type, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_items(user_id, chat_id, topic_id, key);
      CREATE INDEX IF NOT EXISTS idx_topic_states_lookup ON topic_states(user_id, chat_id, topic_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_topic_states_accessed ON topic_states(user_id, chat_id, last_accessed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_active_contexts_lookup ON active_contexts(user_id, chat_id);
    `);
  }

  applySchemaV5() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_ai_settings (
        user_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        fallback_enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_ai_settings_provider ON user_ai_settings(provider_id, updated_at DESC);
    `);
  }

  applySchemaV6() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_quota_settings (
        user_id TEXT PRIMARY KEY,
        daily_quota INTEGER NOT NULL CHECK(daily_quota >= 0),
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_quota_settings_updated ON user_quota_settings(updated_at DESC);
    `);
  }

  applySchemaV7() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS star_orders (
        id TEXT PRIMARY KEY,
        invoice_payload TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'XTR' CHECK(currency = 'XTR'),
        amount INTEGER NOT NULL CHECK(amount > 0),
        grants_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'paid', 'refund_pending', 'refunded', 'expired', 'failed')),
        telegram_payment_charge_id TEXT UNIQUE,
        provider_payment_charge_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL DEFAULT '',
        paid_at TEXT NOT NULL DEFAULT '',
        refunded_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS user_credit_balances (
        user_id TEXT NOT NULL,
        credit_type TEXT NOT NULL
          CHECK(credit_type IN ('chat', 'vision', 'image_generation', 'tts', 'live_voice', 'video')),
        balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, credit_type),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS daily_credit_usage (
        user_id TEXT NOT NULL,
        credit_type TEXT NOT NULL
          CHECK(credit_type IN ('chat', 'vision', 'image_generation', 'tts', 'live_voice', 'video')),
        usage_date TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, credit_type, usage_date),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        request_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        credit_type TEXT NOT NULL
          CHECK(credit_type IN ('chat', 'vision', 'image_generation', 'tts', 'live_voice', 'video')),
        units INTEGER NOT NULL CHECK(units > 0),
        source TEXT NOT NULL CHECK(source IN ('admin', 'daily_free', 'paid')),
        status TEXT NOT NULL DEFAULT 'reserved'
          CHECK(status IN ('reserved', 'consumed', 'refunded')),
        balance_before INTEGER NOT NULL DEFAULT 0 CHECK(balance_before >= 0),
        balance_after INTEGER NOT NULL DEFAULT 0 CHECK(balance_after >= 0),
        usage_date TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS star_refunds (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL UNIQUE,
        telegram_payment_charge_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'succeeded', 'failed')),
        requested_by TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        revoked_grants_json TEXT NOT NULL DEFAULT '{}',
        lease_token TEXT NOT NULL DEFAULT '',
        lease_expires_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(order_id) REFERENCES star_orders(id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_star_orders_user_created
        ON star_orders(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_star_orders_status_updated
        ON star_orders(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_credit_balances_updated
        ON user_credit_balances(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_daily_credit_usage_date
        ON daily_credit_usage(usage_date, credit_type, used DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_records_user_created
        ON usage_records(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_records_type_status
        ON usage_records(credit_type, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_star_refunds_status_updated
        ON star_refunds(status, updated_at DESC);
    `);
  }

  applySchemaV8() {
    const columns = new Set(this.db.prepare('PRAGMA table_info(star_refunds)').all().map((column) => column.name));
    if (!columns.has('lease_token')) {
      this.db.exec("ALTER TABLE star_refunds ADD COLUMN lease_token TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.has('lease_expires_at')) {
      this.db.exec("ALTER TABLE star_refunds ADD COLUMN lease_expires_at TEXT NOT NULL DEFAULT ''");
    }
  }

  ensureFavoritesV2Columns() {
    const columns = this.db.prepare('PRAGMA table_info(favorites)').all();
    const existing = new Set(columns.map((column) => column.name));
    const alterStatements = [
      existing.has('target_type') ? '' : "ALTER TABLE favorites ADD COLUMN target_type TEXT NOT NULL DEFAULT 'message'",
      existing.has('target_id') ? '' : "ALTER TABLE favorites ADD COLUMN target_id TEXT NOT NULL DEFAULT ''",
      existing.has('session_id') ? '' : "ALTER TABLE favorites ADD COLUMN session_id TEXT NOT NULL DEFAULT ''",
      existing.has('message_version_id') ? '' : "ALTER TABLE favorites ADD COLUMN message_version_id TEXT NOT NULL DEFAULT ''",
      existing.has('prompt_id') ? '' : "ALTER TABLE favorites ADD COLUMN prompt_id TEXT NOT NULL DEFAULT ''",
      existing.has('updated_at') ? '' : "ALTER TABLE favorites ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"
    ].filter(Boolean);

    for (const sql of alterStatements) {
      this.db.exec(sql);
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_favorites_user_type_created ON favorites(user_id, target_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_favorites_chat_session ON favorites(chat_id, session_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_target_unique ON favorites(chat_id, user_id, target_type, target_id);
    `);
  }

  backfillFavoritesTargets() {
    this.db.prepare(
      `UPDATE favorites
       SET target_type = CASE WHEN target_type = '' THEN 'message' ELSE target_type END,
           target_id = CASE
             WHEN target_id != '' THEN target_id
             ELSE ('legacy:' || chat_id || ':' || user_id || ':' || message_id)
           END,
           updated_at = CASE WHEN updated_at = '' THEN created_at ELSE updated_at END
       WHERE target_id = '' OR target_type = '' OR updated_at = ''`
    ).run();
  }

  migrateConversationsToStructuredHistory() {
    const rows = this.db.prepare('SELECT session_id, messages_json, created_at, updated_at FROM conversations').all();
    for (const row of rows) {
      let messages = [];
      try {
        messages = JSON.parse(row.messages_json);
      } catch {
        messages = [];
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        this.ensureSessionFromId(row.session_id, row.created_at || now(), row.updated_at || now());
        continue;
      }
      this.syncConversationMessages(row.session_id, messages, {
        source: 'legacy',
        createdAt: row.created_at || now(),
        updatedAt: row.updated_at || now(),
        touchMeta: false
      });
    }
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value || '';
  }

  setMeta(key, value) {
    this.db
      .prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }

  ensureStatsRow(startedAt = now()) {
    this.db
      .prepare(
        `INSERT INTO stats(id, started_at)
         VALUES (1, ?)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(startedAt);
  }

  async importLegacyJsonIfNeeded() {
    const createdAt = this.getMeta('createdAt');
    if (createdAt) {
      return;
    }

    this.applySchemaV1();

    if (!this.legacyFilePath) return;

    let content;
    try {
      content = await fs.readFile(this.legacyFilePath, 'utf8');
    } catch {
      return;
    }

    const legacy = parseLegacyData(content);
    if (!legacy) return;

    const importUsers = this.db.prepare(`
      INSERT OR REPLACE INTO users (
        id, username, first_name, last_name, is_admin, is_blocked, is_allowed,
        preferred_model, preferred_language, persona, custom_system_prompt,
        daily_usage_date, daily_usage_count, total_messages, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const importChats = this.db.prepare(`
      INSERT OR REPLACE INTO chats (
        id, type, title, username, trigger_mode, keyword, default_model, system_prompt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const importConversation = this.db.prepare(`
      INSERT OR REPLACE INTO conversations (session_id, messages_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    this.db.exec('BEGIN');
    try {
      for (const user of legacy.users) {
        importUsers.run(
          String(user.id),
          user.username || '',
          user.firstName || '',
          user.lastName || '',
          user.isAdmin ? 1 : 0,
          user.isBlocked ? 1 : 0,
          user.isAllowed ? 1 : 0,
          user.preferredModel || '',
          user.preferredLanguage || 'zh',
          user.persona || 'default',
          user.customSystemPrompt || '',
          user.dailyUsageDate || '',
          user.dailyUsageCount || 0,
          user.totalMessages || 0,
          user.lastSeenAt || '',
          user.createdAt || now(),
          user.updatedAt || now()
        );
      }

      for (const chat of legacy.chats) {
        importChats.run(
          String(chat.id),
          chat.type || '',
          chat.title || '',
          chat.username || '',
          chat.triggerMode || 'smart',
          chat.keyword || 'ai',
          chat.defaultModel || '',
          chat.systemPrompt || '',
          chat.createdAt || now(),
          chat.updatedAt || now()
        );
      }

      for (const conversation of legacy.conversations) {
        importConversation.run(
          String(conversation.sessionId),
          JSON.stringify(conversation.messages || []),
          conversation.createdAt || now(),
          conversation.updatedAt || now()
        );
      }

      this.db
        .prepare(
          `INSERT OR REPLACE INTO stats(
            id, messages_handled, ai_calls, tool_calls, voice_transcriptions, image_generations, tts_generations, started_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          legacy.stats.messagesHandled || 0,
          legacy.stats.aiCalls || 0,
          legacy.stats.toolCalls || 0,
          legacy.stats.voiceTranscriptions || 0,
          legacy.stats.imageGenerations || 0,
          legacy.stats.ttsGenerations || 0,
          legacy.stats.startedAt || now()
        );

      this.setMeta('createdAt', legacy.meta.createdAt || now());
      this.setMeta('updatedAt', legacy.meta.updatedAt || now());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async write() {
    this.setMeta('updatedAt', now());
  }

  runImmediateTransaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Preserve the original database error.
      }
      throw error;
    }
  }

  findUser(userId) {
    return rowToUser(
      this.db
        .prepare(
          `SELECT users.*,
                  (SELECT daily_quota FROM user_quota_settings WHERE user_id = users.id) AS daily_quota_override
           FROM users
           WHERE users.id = ?`
        )
        .get(String(userId))
    );
  }

  findChat(chatId) {
    return rowToChat(this.db.prepare('SELECT * FROM chats WHERE id = ?').get(String(chatId)));
  }

  async upsertUser(telegramUser, { isAdmin = false } = {}) {
    const id = String(telegramUser.id);
    const existing = this.findUser(id);

    if (!existing) {
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO users (
            id, username, first_name, last_name, is_admin, is_blocked, is_allowed,
            preferred_model, preferred_language, persona, custom_system_prompt,
            daily_usage_date, daily_usage_count, total_messages, last_seen_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, 0, '', ?, 'default', '', '', 0, 0, ?, ?, ?)`
        )
        .run(
          id,
          telegramUser.username || '',
          telegramUser.first_name || '',
          telegramUser.last_name || '',
          isAdmin ? 1 : 0,
          normalizeLanguageCode(telegramUser.language_code, 'zh'),
          timestamp,
          timestamp,
          timestamp
        );
    } else {
      this.db
        .prepare(
          `UPDATE users
           SET username = ?,
               first_name = ?,
               last_name = ?,
               is_admin = ?,
               preferred_language = ?,
               last_seen_at = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(
          telegramUser.username || existing.username,
          telegramUser.first_name || existing.firstName,
          telegramUser.last_name || existing.lastName,
          existing.isAdmin || isAdmin ? 1 : 0,
          existing.preferredLanguage || normalizeLanguageCode(telegramUser.language_code, 'zh'),
          now(),
          now(),
          id
        );
    }

    await this.write();
    return this.findUser(id);
  }

  async upsertChat(chat, defaults = {}) {
    const id = String(chat.id);
    const existing = this.findChat(id);

    if (!existing) {
      const timestamp = now();
      this.db
        .prepare(
          `INSERT INTO chats (
            id, type, title, username, trigger_mode, keyword, default_model, system_prompt, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?)`
        )
        .run(
          id,
          chat.type || '',
          chat.title || '',
          chat.username || '',
          defaults.triggerMode || 'smart',
          defaults.keyword || 'ai',
          timestamp,
          timestamp
        );
    } else {
      this.db
        .prepare('UPDATE chats SET title = ?, username = ?, updated_at = ? WHERE id = ?')
        .run(chat.title || existing.title, chat.username || existing.username, now(), id);
    }

    await this.write();
    return this.findChat(id);
  }

  async setChatSettings(chatId, patch) {
    const changes = mapPatchToColumns(patch, chatColumns);
    if (changes.length === 0) return this.findChat(chatId);

    const assignments = changes.map(([column]) => `${column} = ?`).join(', ');
    const values = changes.map(([, value]) => value);
    this.db
      .prepare(`UPDATE chats SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...values, now(), String(chatId));
    await this.write();
    return this.findChat(chatId);
  }

  async setUserSettings(userId, patch) {
    const changes = mapPatchToColumns(patch, userColumns);
    if (changes.length === 0) return this.findUser(userId);

    const assignments = changes.map(([column]) => `${column} = ?`).join(', ');
    const values = changes.map(([, value]) => (typeof value === 'boolean' ? (value ? 1 : 0) : value));
    this.db
      .prepare(`UPDATE users SET ${assignments}, updated_at = ? WHERE id = ?`)
      .run(...values, now(), String(userId));
    await this.write();
    return this.findUser(userId);
  }

  getUserAISettings(userId) {
    const row = this.db
      .prepare('SELECT user_id, provider_id, model_id, fallback_enabled, updated_at FROM user_ai_settings WHERE user_id = ?')
      .get(String(userId));
    if (!row) {
      return {
        userId: String(userId),
        providerId: '',
        modelId: '',
        fallbackEnabled: true,
        updatedAt: ''
      };
    }
    return {
      userId: row.user_id,
      providerId: row.provider_id || '',
      modelId: row.model_id || '',
      fallbackEnabled: toBoolean(row.fallback_enabled),
      updatedAt: row.updated_at || ''
    };
  }

  setUserAISettings(userId, patch = {}) {
    const existing = this.getUserAISettings(userId);
    const next = {
      providerId: Object.hasOwn(patch, 'providerId') ? String(patch.providerId || '') : existing.providerId,
      modelId: Object.hasOwn(patch, 'modelId') ? String(patch.modelId || '') : existing.modelId,
      fallbackEnabled: Object.hasOwn(patch, 'fallbackEnabled')
        ? Boolean(patch.fallbackEnabled)
        : existing.fallbackEnabled
    };
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO user_ai_settings(user_id, provider_id, model_id, fallback_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           provider_id = excluded.provider_id,
           model_id = excluded.model_id,
           fallback_enabled = excluded.fallback_enabled,
           updated_at = excluded.updated_at`
      )
      .run(String(userId), next.providerId, next.modelId, next.fallbackEnabled ? 1 : 0, timestamp);
    this.setMeta('updatedAt', timestamp);
    return this.getUserAISettings(userId);
  }

  setUserProvider(userId, providerId) {
    return this.setUserAISettings(userId, { providerId, modelId: '' });
  }

  setUserModel(userId, modelId) {
    return this.setUserAISettings(userId, { modelId });
  }

  setUserFallbackEnabled(userId, enabled) {
    return this.setUserAISettings(userId, { fallbackEnabled: Boolean(enabled) });
  }

  resetUserAISettings(userId) {
    const timestamp = now();
    this.db.prepare('DELETE FROM user_ai_settings WHERE user_id = ?').run(String(userId));
    this.setMeta('updatedAt', timestamp);
    return this.getUserAISettings(userId);
  }

  ensureSessionFromId(sessionId, createdAt = now(), updatedAt = now()) {
    const identity = parseSessionIdentity(sessionId);
    const timestamp = updatedAt || now();
    this.db
      .prepare(
        `INSERT INTO sessions(
          id, chat_id, user_id, thread_id, name, status, is_default, last_accessed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'main', 'active', 1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          last_accessed_at = excluded.last_accessed_at,
          updated_at = excluded.updated_at`
      )
      .run(String(sessionId), identity.chatId, identity.userId, identity.threadId, timestamp, createdAt || timestamp, timestamp);
    return this.findSession(sessionId);
  }

  findSession(sessionId) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(String(sessionId));
    return rowToSession(row);
  }

  async createSession({ chatId, userId, threadId = 'main', name = '', isDefault = false }) {
    const normalizedName = name?.trim() || (isDefault ? 'main' : `session-${Date.now()}`);
    const id = isDefault
      ? `${String(chatId)}:${String(userId)}:${String(threadId || 'main')}`
      : `${String(chatId)}:${String(userId)}:${String(threadId || 'main')}:${randomUUID().slice(0, 8)}`;
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO sessions(
          id, chat_id, user_id, thread_id, name, status, is_default, last_accessed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
      )
      .run(id, String(chatId), String(userId), String(threadId || 'main'), normalizedName, toIntegerBoolean(isDefault), timestamp, timestamp, timestamp);
    await this.write();
    return this.findSession(id);
  }

  listSessions({ chatId = '', userId = '', threadId = '', status = 'active', limit = 20, offset = 0 } = {}) {
    const filters = [];
    const params = [];
    if (chatId) {
      filters.push('chat_id = ?');
      params.push(String(chatId));
    }
    if (userId) {
      filters.push('user_id = ?');
      params.push(String(userId));
    }
    if (threadId) {
      filters.push('thread_id = ?');
      params.push(String(threadId));
    }
    if (status) {
      filters.push('status = ?');
      params.push(String(status));
    }
    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions
         ${whereClause}
         ORDER BY last_accessed_at DESC, created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, Math.max(1, Number(limit) || 20), Math.max(0, Number(offset) || 0));
    return rows.map(rowToSession);
  }

  async setSessionStatus(sessionId, status = 'active') {
    this.db
      .prepare('UPDATE sessions SET status = ?, updated_at = ?, last_accessed_at = ? WHERE id = ?')
      .run(String(status || 'active'), now(), now(), String(sessionId));
    await this.write();
    return this.findSession(sessionId);
  }

  async touchSession(sessionId) {
    const timestamp = now();
    this.db
      .prepare('UPDATE sessions SET last_accessed_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, String(sessionId));
    await this.write();
  }

  async deleteSession(sessionId) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(String(sessionId));
    this.db.prepare('DELETE FROM conversations WHERE session_id = ?').run(String(sessionId));
    await this.write();
  }

  getConversationEntries(sessionId, { limit = 0, offset = 0, order = 'asc' } = {}) {
    this.ensureSessionFromId(String(sessionId));
    const sortOrder = order === 'desc' ? 'DESC' : 'ASC';
    const limitClause = limit > 0 ? 'LIMIT ? OFFSET ?' : '';
    const params = [String(sessionId)];
    if (limit > 0) {
      params.push(Number(limit), Number(offset || 0));
    }

    const rows = this.db
      .prepare(
        `SELECT
           m.id AS message_id,
           m.role,
           m.sequence,
           m.active_version,
           mv.id AS message_version_id,
           mv.content_json,
           mv.model,
           mv.created_at AS version_created_at,
           m.created_at,
           m.updated_at
         FROM messages m
         JOIN message_versions mv
           ON mv.message_id = m.id
          AND mv.version = m.active_version
         WHERE m.session_id = ?
         ORDER BY m.sequence ${sortOrder}
         ${limitClause}`
      )
      .all(...params);

    return rows.map((row) => {
      let content = '';
      try {
        content = JSON.parse(row.content_json);
      } catch {
        content = '';
      }
      return {
        messageId: row.message_id,
        messageVersionId: row.message_version_id,
        role: row.role,
        content,
        version: row.active_version,
        model: row.model || '',
        sequence: row.sequence,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        versionCreatedAt: row.version_created_at
      };
    });
  }

  getConversation(sessionId) {
    const entries = this.getConversationEntries(sessionId, { order: 'asc' });
    if (entries.length > 0) {
      return entries.map((entry) => ({ role: entry.role, content: entry.content }));
    }

    const row = this.db
      .prepare('SELECT messages_json FROM conversations WHERE session_id = ?')
      .get(String(sessionId));
    if (!row?.messages_json) return [];
    try {
      return JSON.parse(row.messages_json);
    } catch {
      return [];
    }
  }

  getConversationForContext(sessionId, { maxMessages = 0, strategy = 'recent' } = {}) {
    const allMessages = this.getConversation(sessionId);
    if (maxMessages <= 0 || strategy !== 'recent') {
      return allMessages;
    }
    const approximateLimit = maxMessages * 3;
    return allMessages.slice(-approximateLimit);
  }

  getMessageVersionHistory(messageId) {
    const rows = this.db
      .prepare(
        `SELECT id, message_id, version, content_json, model, is_current, created_at
         FROM message_versions
         WHERE message_id = ?
         ORDER BY version DESC`
      )
      .all(String(messageId));
    return rows.map((row) => {
      let content = '';
      try {
        content = JSON.parse(row.content_json);
      } catch {
        content = '';
      }
      return {
        id: row.id,
        messageId: row.message_id,
        version: row.version,
        content,
        model: row.model || '',
        isCurrent: toBoolean(row.is_current),
        createdAt: row.created_at
      };
    });
  }

  getLatestAssistantMessageReference(sessionId) {
    const row = this.db
      .prepare(
        `SELECT
           m.id AS message_id,
           m.active_version,
           mv.id AS message_version_id,
           mv.content_json,
           mv.model
         FROM messages m
         JOIN message_versions mv
           ON mv.message_id = m.id
          AND mv.version = m.active_version
         WHERE m.session_id = ? AND m.role = 'assistant'
         ORDER BY m.sequence DESC
         LIMIT 1`
      )
      .get(String(sessionId));

    if (!row) return null;
    let content = '';
    try {
      content = JSON.parse(row.content_json);
    } catch {
      content = '';
    }
    return {
      messageId: row.message_id,
      messageVersionId: row.message_version_id,
      version: row.active_version,
      content,
      model: row.model || ''
    };
  }

  syncConversationMessages(sessionId, messages, { source = 'chat', createdAt = '', updatedAt = '', touchMeta = true } = {}) {
    const safeMessages = Array.isArray(messages) ? messages : [];
    const timestamp = updatedAt || now();
    const createdTimestamp = createdAt || timestamp;
    this.ensureSessionFromId(String(sessionId), createdTimestamp, timestamp);

    const existingRows = this.db
      .prepare('SELECT id, role, sequence, active_version, created_at FROM messages WHERE session_id = ? ORDER BY sequence ASC')
      .all(String(sessionId));
    const existingBySequence = new Map(existingRows.map((row) => [row.sequence, row]));

    this.db.exec('BEGIN');

    try {
      for (let index = 0; index < safeMessages.length; index += 1) {
        const sequence = index + 1;
        const item = safeMessages[index] || {};
        const role = String(item.role || 'user');
        const contentJson = JSON.stringify(item.content ?? '');
        const model = String(item.model || '');
        const existing = existingBySequence.get(sequence);

        if (!existing || existing.role !== role) {
          if (existing && existing.role !== role) {
            this.db.prepare('DELETE FROM messages WHERE id = ?').run(existing.id);
          }

          const messageId = createMessageId(sessionId, sequence);
          const versionId = createVersionId(messageId, 1);
          this.db
            .prepare(
              `INSERT INTO messages(
                id, session_id, role, sequence, parent_message_id, active_version, status, source, created_at, updated_at
              ) VALUES (?, ?, ?, ?, NULL, 1, 'active', ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                role = excluded.role,
                sequence = excluded.sequence,
                source = excluded.source,
                updated_at = excluded.updated_at`
            )
            .run(messageId, String(sessionId), role, sequence, source, createdTimestamp, timestamp);

          this.db
            .prepare(
              `INSERT INTO message_versions(
                id, message_id, version, content_json, model, prompt_snapshot_json, context_snapshot_json, is_current, created_at
              ) VALUES (?, ?, 1, ?, ?, '', '', 1, ?)
              ON CONFLICT(message_id, version) DO UPDATE SET
                content_json = excluded.content_json,
                model = excluded.model,
                is_current = 1`
            )
            .run(versionId, messageId, contentJson, model, timestamp);

          this.db.prepare('UPDATE message_versions SET is_current = 0 WHERE message_id = ? AND id != ?').run(messageId, versionId);
          continue;
        }

        const currentVersionRow = this.db
          .prepare('SELECT id, version, content_json FROM message_versions WHERE message_id = ? AND version = ?')
          .get(existing.id, existing.active_version);

        if (!currentVersionRow || currentVersionRow.content_json !== contentJson) {
          const nextVersion = Number(existing.active_version || 0) + 1;
          const versionId = createVersionId(existing.id, nextVersion);
          this.db.prepare('UPDATE message_versions SET is_current = 0 WHERE message_id = ?').run(existing.id);
          this.db
            .prepare(
              `INSERT INTO message_versions(
                id, message_id, version, content_json, model, prompt_snapshot_json, context_snapshot_json, is_current, created_at
              ) VALUES (?, ?, ?, ?, ?, '', '', 1, ?)
              ON CONFLICT(message_id, version) DO UPDATE SET
                content_json = excluded.content_json,
                model = excluded.model,
                is_current = 1`
            )
            .run(versionId, existing.id, nextVersion, contentJson, model, timestamp);

          this.db
            .prepare('UPDATE messages SET active_version = ?, updated_at = ? WHERE id = ?')
            .run(nextVersion, timestamp, existing.id);
        } else {
          this.db
            .prepare('UPDATE messages SET updated_at = ? WHERE id = ?')
            .run(timestamp, existing.id);
        }
      }

      if (existingRows.length > safeMessages.length) {
        this.db
          .prepare('DELETE FROM messages WHERE session_id = ? AND sequence > ?')
          .run(String(sessionId), safeMessages.length);
      }

      this.db
        .prepare('UPDATE sessions SET last_accessed_at = ?, updated_at = ? WHERE id = ?')
        .run(timestamp, timestamp, String(sessionId));

      this.db
        .prepare(
          `INSERT OR REPLACE INTO conversations(session_id, messages_json, created_at, updated_at)
           VALUES (?, ?, COALESCE((SELECT created_at FROM conversations WHERE session_id = ?), ?), ?)`
        )
        .run(String(sessionId), JSON.stringify(safeMessages), String(sessionId), createdTimestamp, timestamp);

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    if (touchMeta) {
      this.setMeta('updatedAt', now());
    }
  }

  async setConversation(sessionId, messages) {
    this.syncConversationMessages(sessionId, messages, { source: 'chat', touchMeta: true });
    await this.write();
  }

  async clearConversation(sessionId) {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(String(sessionId));
    this.db.prepare('DELETE FROM conversations WHERE session_id = ?').run(String(sessionId));
    await this.touchSession(sessionId);
  }

  findFavorite(chatId, userId, messageIdOrTargetId) {
    return this.db
      .prepare(
        `SELECT * FROM favorites
         WHERE chat_id = ? AND user_id = ?
           AND (message_id = ? OR target_id = ?)
         LIMIT 1`
      )
      .get(String(chatId), String(userId), String(messageIdOrTargetId), String(messageIdOrTargetId));
  }

  listFavorites({ chatId = '', userId = '', sessionId = '', targetType = '', limit = 50, offset = 0 } = {}) {
    const filters = [];
    const params = [];
    if (chatId) {
      filters.push('chat_id = ?');
      params.push(String(chatId));
    }
    if (userId) {
      filters.push('user_id = ?');
      params.push(String(userId));
    }
    if (sessionId) {
      filters.push('session_id = ?');
      params.push(String(sessionId));
    }
    if (targetType) {
      filters.push('target_type = ?');
      params.push(String(targetType));
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT * FROM favorites
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, Math.max(1, Number(limit) || 50), Math.max(0, Number(offset) || 0));
  }

  async saveFavorite({
    chatId,
    userId,
    sessionId = '',
    messageId = '',
    messageVersionId = '',
    promptId = '',
    targetType = '',
    targetId = '',
    text,
    sourceText = '',
    model = '',
    locale = 'zh'
  }) {
    const resolved = normalizeFavoriteTarget({ targetType, targetId, promptId, messageVersionId, messageId });
    const timestamp = now();

    this.db
      .prepare(
        `INSERT INTO favorites(
          chat_id, user_id, message_id, text, source_text, model, locale, created_at,
          target_type, target_id, session_id, message_version_id, prompt_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chat_id, user_id, target_type, target_id)
        DO UPDATE SET
          text = excluded.text,
          source_text = excluded.source_text,
          model = excluded.model,
          locale = excluded.locale,
          session_id = excluded.session_id,
          message_version_id = excluded.message_version_id,
          prompt_id = excluded.prompt_id,
          updated_at = excluded.updated_at`
      )
      .run(
        String(chatId),
        String(userId),
        String(resolved.messageId || messageId || resolved.targetId),
        String(text || ''),
        String(sourceText || ''),
        String(model || ''),
        String(locale || 'zh'),
        timestamp,
        String(resolved.targetType),
        String(resolved.targetId),
        String(sessionId || ''),
        String(resolved.messageVersionId || ''),
        String(resolved.promptId || ''),
        timestamp
      );
    await this.write();

    return this.db
      .prepare(
        `SELECT * FROM favorites
         WHERE chat_id = ? AND user_id = ? AND target_type = ? AND target_id = ?`
      )
      .get(String(chatId), String(userId), String(resolved.targetType), String(resolved.targetId));
  }

  async savePrompt({
    promptKey = '',
    parentPromptId = '',
    ownerUserId = '',
    chatId = '',
    sessionId = '',
    scope = 'user',
    kind = 'system',
    name = '',
    content = '',
    isActive = true,
    isDefault = false
  }) {
    const key = String(promptKey || randomUUID());
    const latest = this.db
      .prepare('SELECT id, version FROM prompts WHERE prompt_key = ? ORDER BY version DESC LIMIT 1')
      .get(key);
    const version = latest ? Number(latest.version || 1) + 1 : 1;
    const id = randomUUID();
    const parentId = parentPromptId || latest?.id || null;
    const timestamp = now();

    if (isDefault) {
      this.db
        .prepare(
          `UPDATE prompts
           SET is_default = 0, updated_at = ?
           WHERE scope = ?
             AND owner_user_id = ?
             AND chat_id = ?
             AND session_id = ?
             AND kind = ?`
        )
        .run(timestamp, String(scope), String(ownerUserId), String(chatId), String(sessionId), String(kind));
    }

    this.db
      .prepare(
        `INSERT INTO prompts(
          id, prompt_key, version, parent_prompt_id, owner_user_id, chat_id, session_id,
          scope, kind, name, content, is_active, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        key,
        version,
        parentId,
        String(ownerUserId),
        String(chatId),
        String(sessionId),
        String(scope),
        String(kind),
        String(name),
        String(content),
        toIntegerBoolean(Boolean(isActive)),
        toIntegerBoolean(Boolean(isDefault)),
        timestamp,
        timestamp
      );

    await this.write();
    return this.getPromptById(id);
  }

  getPromptById(promptId) {
    const row = this.db.prepare('SELECT * FROM prompts WHERE id = ?').get(String(promptId));
    if (!row) return null;
    return {
      id: row.id,
      promptKey: row.prompt_key,
      version: row.version,
      parentPromptId: row.parent_prompt_id || '',
      ownerUserId: row.owner_user_id,
      chatId: row.chat_id,
      sessionId: row.session_id,
      scope: row.scope,
      kind: row.kind,
      name: row.name,
      content: row.content,
      isActive: toBoolean(row.is_active),
      isDefault: toBoolean(row.is_default),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  listPrompts({ ownerUserId = '', chatId = '', sessionId = '', scope = '', kind = '', activeOnly = true, limit = 50 } = {}) {
    const filters = [];
    const params = [];
    if (ownerUserId) {
      filters.push('owner_user_id = ?');
      params.push(String(ownerUserId));
    }
    if (chatId) {
      filters.push('chat_id = ?');
      params.push(String(chatId));
    }
    if (sessionId) {
      filters.push('session_id = ?');
      params.push(String(sessionId));
    }
    if (scope) {
      filters.push('scope = ?');
      params.push(String(scope));
    }
    if (kind) {
      filters.push('kind = ?');
      params.push(String(kind));
    }
    if (activeOnly) {
      filters.push('is_active = 1');
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM prompts
         ${whereClause}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...params, Math.max(1, Number(limit) || 50));

    return rows.map((row) => this.getPromptById(row.id));
  }

  seedAccessControlDefaults() {
    const timestamp = now();
    const roles = [
      { id: 'role_super_admin', name: 'super_admin', description: 'Full platform control' },
      { id: 'role_admin', name: 'admin', description: 'Admin operations' },
      { id: 'role_operator', name: 'operator', description: 'Operational controls' },
      { id: 'role_viewer', name: 'viewer', description: 'Read only' }
    ];
    const permissions = [
      { id: 'perm_users_read', name: 'users:read' },
      { id: 'perm_users_write', name: 'users:write' },
      { id: 'perm_sessions_read', name: 'sessions:read' },
      { id: 'perm_sessions_write', name: 'sessions:write' },
      { id: 'perm_quota_read', name: 'quota:read' },
      { id: 'perm_quota_write', name: 'quota:write' },
      { id: 'perm_providers_read', name: 'providers:read' },
      { id: 'perm_providers_write', name: 'providers:write' },
      { id: 'perm_audit_read', name: 'audit:read' },
      { id: 'perm_flags_read', name: 'flags:read' },
      { id: 'perm_flags_write', name: 'flags:write' },
      { id: 'perm_policy_read', name: 'policy:read' },
      { id: 'perm_policy_write', name: 'policy:write' }
    ];

    const rolePermissions = {
      super_admin: permissions.map((item) => item.name),
      admin: [
        'users:read',
        'users:write',
        'sessions:read',
        'sessions:write',
        'quota:read',
        'quota:write',
        'providers:read',
        'providers:write',
        'audit:read',
        'flags:read',
        'flags:write',
        'policy:read',
        'policy:write'
      ],
      operator: ['users:read', 'sessions:read', 'quota:read', 'providers:read', 'audit:read', 'flags:read', 'policy:read'],
      viewer: ['users:read', 'sessions:read', 'quota:read', 'providers:read', 'audit:read', 'flags:read', 'policy:read']
    };

    const insertRole = this.db.prepare(
      `INSERT INTO roles(id, name, description, is_system, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(name) DO UPDATE SET description = excluded.description, updated_at = excluded.updated_at`
    );
    const insertPermission = this.db.prepare(
      `INSERT INTO permissions(id, name, description, created_at)
       VALUES (?, ?, '', ?)
       ON CONFLICT(name) DO NOTHING`
    );
    const insertRolePermission = this.db.prepare(
      `INSERT OR IGNORE INTO role_permissions(role_id, permission_id, created_at)
       VALUES (?, ?, ?)`
    );

    for (const role of roles) {
      insertRole.run(role.id, role.name, role.description, timestamp, timestamp);
    }
    for (const permission of permissions) {
      insertPermission.run(permission.id, permission.name, timestamp);
    }

    for (const [roleName, names] of Object.entries(rolePermissions)) {
      const role = this.db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName);
      if (!role) continue;
      for (const permissionName of names) {
        const permission = this.db.prepare('SELECT id FROM permissions WHERE name = ?').get(permissionName);
        if (!permission) continue;
        insertRolePermission.run(role.id, permission.id, timestamp);
      }
    }
  }

  listUsers({ q = '', limit = 50, offset = 0 } = {}) {
    const keyword = String(q || '').trim();
    const hasKeyword = Boolean(keyword);
    const rows = this.db
      .prepare(
        `SELECT users.*,
                (SELECT daily_quota FROM user_quota_settings WHERE user_id = users.id) AS daily_quota_override
         FROM users
         ${hasKeyword ? 'WHERE users.id LIKE ? OR users.username LIKE ? OR users.first_name LIKE ? OR users.last_name LIKE ?' : ''}
         ORDER BY users.last_seen_at DESC, users.updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(
        ...(hasKeyword ? Array(4).fill(`%${keyword}%`) : []),
        Math.max(1, Number(limit) || 50),
        Math.max(0, Number(offset) || 0)
      );
    return rows.map(rowToUser);
  }

  countUsers({ q = '' } = {}) {
    const keyword = String(q || '').trim();
    const hasKeyword = Boolean(keyword);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM users
         ${hasKeyword ? 'WHERE id LIKE ? OR username LIKE ? OR first_name LIKE ? OR last_name LIKE ?' : ''}`
      )
      .get(...(hasKeyword ? Array(4).fill(`%${keyword}%`) : []));
    return Number(row?.count || 0);
  }

  listUserRoleNames(userId) {
    const rows = this.db
      .prepare(
        `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ?
         ORDER BY r.name ASC`
      )
      .all(String(userId));
    return rows.map((row) => row.name);
  }

  setUserRoles(userId, roleNames = []) {
    const timestamp = now();
    const id = String(userId);
    this.db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
    const insert = this.db.prepare(
      `INSERT INTO user_roles(user_id, role_id, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, role_id) DO UPDATE SET updated_at = excluded.updated_at`
    );
    for (const roleName of roleNames) {
      const role = this.db.prepare('SELECT id FROM roles WHERE name = ?').get(String(roleName));
      if (!role) continue;
      insert.run(id, role.id, timestamp, timestamp);
    }
    this.setMeta('updatedAt', now());
    return this.listUserRoleNames(id);
  }

  listRoles() {
    return this.db.prepare('SELECT id, name, description, is_system, created_at, updated_at FROM roles ORDER BY name ASC').all();
  }

  listPermissions() {
    return this.db.prepare('SELECT id, name, description, created_at FROM permissions ORDER BY name ASC').all();
  }

  listUserPermissions(userId) {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT p.name
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = ?`
      )
      .all(String(userId));
    return rows.map((row) => row.name);
  }

  upsertFeatureFlag({ flagKey, scopeType = 'global', scopeId = '', enabled = true, payload = {}, updatedBy = '' }) {
    const timestamp = now();
    const existing = this.db
      .prepare('SELECT id FROM feature_flags WHERE flag_key = ? AND scope_type = ? AND scope_id = ? LIMIT 1')
      .get(String(flagKey), String(scopeType), String(scopeId));
    const id = existing?.id || randomUUID();
    this.db
      .prepare(
        `INSERT INTO feature_flags(id, flag_key, scope_type, scope_id, enabled, payload_json, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           enabled = excluded.enabled,
           payload_json = excluded.payload_json,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        String(flagKey),
        String(scopeType),
        String(scopeId),
        enabled ? 1 : 0,
        JSON.stringify(payload || {}),
        String(updatedBy || ''),
        timestamp,
        timestamp
      );
    this.setMeta('updatedAt', now());
    return this.listFeatureFlags({ flagKey, scopeType, scopeId, limit: 1 })[0] || null;
  }

  listFeatureFlags({ flagKey = '', scopeType = '', scopeId = '', limit = 200 } = {}) {
    const filters = [];
    const params = [];
    if (flagKey) {
      filters.push('flag_key = ?');
      params.push(String(flagKey));
    }
    if (scopeType) {
      filters.push('scope_type = ?');
      params.push(String(scopeType));
    }
    if (scopeId) {
      filters.push('scope_id = ?');
      params.push(String(scopeId));
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM feature_flags
         ${whereClause}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...params, Math.max(1, Number(limit) || 200));
    return rows.map((row) => ({
      id: row.id,
      flagKey: row.flag_key,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      enabled: toBoolean(row.enabled),
      payload: (() => {
        try {
          return JSON.parse(row.payload_json || '{}');
        } catch {
          return {};
        }
      })(),
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  resolveFeatureFlag(flagKey, { userId = '', chatId = '', roleNames = [] } = {}) {
    const key = String(flagKey || '');
    if (!key) return false;
    const rows = this.listFeatureFlags({ flagKey: key, limit: 500 });
    const roleSet = new Set((roleNames || []).map(String));

    const find = (scopeType, scopeId = '') =>
      rows.find((item) => item.scopeType === scopeType && String(item.scopeId || '') === String(scopeId || ''));

    return (
      find('user', userId)?.enabled ??
      find('chat', chatId)?.enabled ??
      rows.find((item) => item.scopeType === 'role' && roleSet.has(String(item.scopeId || '')))?.enabled ??
      find('global', '')?.enabled ??
      false
    );
  }

  upsertPolicyRule({ id = '', effect = 'allow', subjectType = 'user', subjectId = '', enabled = true, note = '', createdBy = '' }) {
    const timestamp = now();
    const resolvedId = String(id || randomUUID());
    this.db
      .prepare(
        `INSERT INTO policy_rules(id, effect, subject_type, subject_id, enabled, note, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           effect = excluded.effect,
           subject_type = excluded.subject_type,
           subject_id = excluded.subject_id,
           enabled = excluded.enabled,
           note = excluded.note,
           created_by = excluded.created_by,
           updated_at = excluded.updated_at`
      )
      .run(
        resolvedId,
        String(effect || 'allow'),
        String(subjectType || 'user'),
        String(subjectId || ''),
        enabled ? 1 : 0,
        String(note || ''),
        String(createdBy || ''),
        timestamp,
        timestamp
      );
    this.setMeta('updatedAt', now());
    return this.getPolicyRuleById(resolvedId);
  }

  getPolicyRuleById(id) {
    const row = this.db.prepare('SELECT * FROM policy_rules WHERE id = ?').get(String(id));
    if (!row) return null;
    return {
      id: row.id,
      effect: row.effect,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      enabled: toBoolean(row.enabled),
      note: row.note,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  listPolicyRules({ effect = '', subjectType = '', subjectId = '', limit = 200 } = {}) {
    const filters = ['enabled = 1'];
    const params = [];
    if (effect) {
      filters.push('effect = ?');
      params.push(String(effect));
    }
    if (subjectType) {
      filters.push('subject_type = ?');
      params.push(String(subjectType));
    }
    if (subjectId) {
      filters.push('subject_id = ?');
      params.push(String(subjectId));
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM policy_rules
         WHERE ${filters.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...params, Math.max(1, Number(limit) || 200));
    return rows.map((row) => ({
      id: row.id,
      effect: row.effect,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      enabled: toBoolean(row.enabled),
      note: row.note,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  matchPolicyRule({ effect = 'allow', userId = '', chatId = '', roleNames = [] } = {}) {
    const roleSet = new Set((roleNames || []).map(String));
    const rows = this.listPolicyRules({ effect, limit: 1000 });
    return rows.some((rule) => {
      if (rule.subjectType === 'user' && String(rule.subjectId) === String(userId || '')) return true;
      if (rule.subjectType === 'chat' && String(rule.subjectId) === String(chatId || '')) return true;
      if (rule.subjectType === 'role' && roleSet.has(String(rule.subjectId))) return true;
      return false;
    });
  }

  logAudit({
    actorId = '',
    actorType = 'system',
    action = '',
    targetType = '',
    targetId = '',
    result = 'ok',
    requestId = '',
    ip = '',
    userAgent = '',
    details = {}
  }) {
    this.db
      .prepare(
        `INSERT INTO admin_audit_logs(
          actor_id, actor_type, action, target_type, target_id, result, request_id, ip, user_agent, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(actorId || ''),
        String(actorType || 'system'),
        String(action || ''),
        String(targetType || ''),
        String(targetId || ''),
        String(result || 'ok'),
        String(requestId || ''),
        String(ip || ''),
        String(userAgent || ''),
        JSON.stringify(details || {}),
        now()
      );
    this.setMeta('updatedAt', now());
  }

  listAuditLogs({ actorId = '', action = '', targetType = '', keyword = '', from = '', to = '', limit = 100, offset = 0 } = {}) {
    const filters = [];
    const params = [];
    if (actorId) {
      filters.push('actor_id = ?');
      params.push(String(actorId));
    }
    if (action) {
      filters.push('action = ?');
      params.push(String(action));
    }
    if (targetType) {
      filters.push('target_type = ?');
      params.push(String(targetType));
    }
    if (from) {
      filters.push('created_at >= ?');
      params.push(String(from));
    }
    if (to) {
      filters.push('created_at <= ?');
      params.push(String(to));
    }
    if (keyword) {
      filters.push('(details_json LIKE ? OR target_id LIKE ? OR actor_id LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM admin_audit_logs
         ${whereClause}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, Math.max(1, Number(limit) || 100), Math.max(0, Number(offset) || 0));
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorType: row.actor_type,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      result: row.result,
      requestId: row.request_id,
      ip: row.ip,
      userAgent: row.user_agent,
      details: (() => {
        try {
          return JSON.parse(row.details_json || '{}');
        } catch {
          return {};
        }
      })(),
      createdAt: row.created_at
    }));
  }

  upsertProviderConfig({ providerId, enabled = true, isDefault = false, capabilities = [], meta = {} }) {
    const id = String(providerId || '');
    if (!id) return null;
    const timestamp = now();
    if (isDefault) {
      this.db.prepare('UPDATE provider_configs SET is_default = 0, updated_at = ?').run(timestamp);
    }
    this.db
      .prepare(
        `INSERT INTO provider_configs(provider_id, enabled, is_default, capabilities_json, meta_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
           enabled = excluded.enabled,
           is_default = excluded.is_default,
           capabilities_json = excluded.capabilities_json,
           meta_json = excluded.meta_json,
           updated_at = excluded.updated_at`
      )
      .run(id, enabled ? 1 : 0, isDefault ? 1 : 0, JSON.stringify(capabilities || []), JSON.stringify(meta || {}), timestamp);
    this.setMeta('updatedAt', now());
    return this.listProviderConfigs().find((item) => item.providerId === id) || null;
  }

  listProviderConfigs() {
    const rows = this.db.prepare('SELECT * FROM provider_configs ORDER BY provider_id ASC').all();
    return rows.map((row) => ({
      providerId: row.provider_id,
      enabled: toBoolean(row.enabled),
      isDefault: toBoolean(row.is_default),
      capabilities: (() => {
        try {
          return JSON.parse(row.capabilities_json || '[]');
        } catch {
          return [];
        }
      })(),
      meta: (() => {
        try {
          return JSON.parse(row.meta_json || '{}');
        } catch {
          return {};
        }
      })(),
      updatedAt: row.updated_at
    }));
  }

  upsertModelConfig({ modelId, providerId = '', enabled = true, isDefault = false, meta = {} }) {
    const id = String(modelId || '');
    if (!id) return null;
    const timestamp = now();
    if (isDefault) {
      this.db.prepare('UPDATE model_configs SET is_default = 0, updated_at = ?').run(timestamp);
    }
    this.db
      .prepare(
        `INSERT INTO model_configs(model_id, provider_id, enabled, is_default, meta_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(model_id) DO UPDATE SET
           provider_id = excluded.provider_id,
           enabled = excluded.enabled,
           is_default = excluded.is_default,
           meta_json = excluded.meta_json,
           updated_at = excluded.updated_at`
      )
      .run(id, String(providerId || ''), enabled ? 1 : 0, isDefault ? 1 : 0, JSON.stringify(meta || {}), timestamp);
    this.setMeta('updatedAt', now());
    return this.listModelConfigs().find((item) => item.modelId === id) || null;
  }

  listModelConfigs() {
    const rows = this.db.prepare('SELECT * FROM model_configs ORDER BY model_id ASC').all();
    return rows.map((row) => ({
      modelId: row.model_id,
      providerId: row.provider_id,
      enabled: toBoolean(row.enabled),
      isDefault: toBoolean(row.is_default),
      meta: (() => {
        try {
          return JSON.parse(row.meta_json || '{}');
        } catch {
          return {};
        }
      })(),
      updatedAt: row.updated_at
    }));
  }

  listAdminSessions({ userId = '', chatId = '', status = '', limit = 50, offset = 0 } = {}) {
    return this.listSessions({ userId, chatId, status, limit, offset });
  }

  getSessionMessageSummary(sessionId, { limit = 20 } = {}) {
    return this.getConversationEntries(sessionId, { limit, order: 'desc' }).map((entry) => ({
      role: entry.role,
      model: entry.model,
      content: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content),
      createdAt: entry.createdAt
    }));
  }

  async incrementStats(key, by = 1) {
    const columns = {
      messagesHandled: 'messages_handled',
      aiCalls: 'ai_calls',
      toolCalls: 'tool_calls',
      voiceTranscriptions: 'voice_transcriptions',
      imageGenerations: 'image_generations',
      ttsGenerations: 'tts_generations'
    };
    const column = columns[key];
    if (!column) return;
    this.ensureStatsRow();
    this.db.prepare(`UPDATE stats SET ${column} = ${column} + ? WHERE id = 1`).run(by);
    await this.write();
  }

  getStats() {
    this.ensureStatsRow();
    const row = this.db.prepare('SELECT * FROM stats WHERE id = 1').get();
    return {
      messagesHandled: row?.messages_handled || 0,
      aiCalls: row?.ai_calls || 0,
      toolCalls: row?.tool_calls || 0,
      voiceTranscriptions: row?.voice_transcriptions || 0,
      imageGenerations: row?.image_generations || 0,
      ttsGenerations: row?.tts_generations || 0,
      startedAt: row?.started_at || now()
    };
  }

  consumeDailyQuota(userId, quota) {
    const user = this.findUser(userId);
    if (!user) return { allowed: false, remaining: 0, quota: 0, dailyQuotaOverride: null };

    const configuredQuota = Number(quota);
    const globalQuota = Number.isSafeInteger(configuredQuota) && configuredQuota >= 0 ? configuredQuota : 0;
    const dailyQuotaOverride = user.dailyQuotaOverride;
    const effectiveQuota = dailyQuotaOverride == null ? globalQuota : dailyQuotaOverride;

    const today = new Date().toISOString().slice(0, 10);
    let dailyUsageCount = user.dailyUsageCount;
    if (user.dailyUsageDate !== today) {
      dailyUsageCount = 0;
      this.db
        .prepare('UPDATE users SET daily_usage_date = ?, daily_usage_count = 0, updated_at = ? WHERE id = ?')
        .run(today, now(), String(userId));
    }

    if (effectiveQuota > 0 && dailyUsageCount >= effectiveQuota) {
      return { allowed: false, remaining: 0, quota: effectiveQuota, dailyQuotaOverride };
    }

    this.db
      .prepare(
        `UPDATE users
         SET daily_usage_date = ?, daily_usage_count = daily_usage_count + 1, total_messages = total_messages + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(today, now(), String(userId));
    this.db
      .prepare(
        `INSERT INTO daily_credit_usage(user_id, credit_type, usage_date, used, updated_at)
         VALUES (?, 'chat', ?, ?, ?)
         ON CONFLICT(user_id, credit_type, usage_date) DO UPDATE SET
           used = excluded.used,
           updated_at = excluded.updated_at`
      )
      .run(String(userId), today, dailyUsageCount + 1, now());
    return {
      allowed: true,
      remaining: effectiveQuota > 0 ? Math.max(0, effectiveQuota - dailyUsageCount - 1) : Infinity,
      quota: effectiveQuota,
      dailyQuotaOverride
    };
  }

  getUserDailyQuota(userId, defaultQuota = 0) {
    const user = this.findUser(userId);
    if (!user) return null;

    const configuredQuota = Number(defaultQuota);
    const globalQuota = Number.isSafeInteger(configuredQuota) && configuredQuota >= 0 ? configuredQuota : 0;
    const dailyQuotaOverride = user.dailyQuotaOverride;
    return {
      userId: String(user.id),
      dailyQuota: dailyQuotaOverride == null ? globalQuota : dailyQuotaOverride,
      dailyQuotaOverride,
      usesGlobalQuota: dailyQuotaOverride == null
    };
  }

  setUserDailyQuota(userId, quota = null, defaultQuota = 0) {
    const user = this.findUser(userId);
    if (!user) return null;

    if (quota == null) {
      return this.clearUserDailyQuota(userId, defaultQuota);
    }

    const normalizedQuota = Number(quota);
    if (!Number.isSafeInteger(normalizedQuota) || normalizedQuota < 0) {
      throw new RangeError('Daily quota must be a non-negative safe integer.');
    }

    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO user_quota_settings(user_id, daily_quota, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           daily_quota = excluded.daily_quota,
           updated_at = excluded.updated_at`
      )
      .run(String(userId), normalizedQuota, timestamp);
    this.setMeta('updatedAt', timestamp);
    return this.getUserDailyQuota(userId, defaultQuota);
  }

  clearUserDailyQuota(userId, defaultQuota = 0) {
    const user = this.findUser(userId);
    if (!user) return null;

    this.db.prepare('DELETE FROM user_quota_settings WHERE user_id = ?').run(String(userId));
    this.setMeta('updatedAt', now());
    return this.getUserDailyQuota(userId, defaultQuota);
  }

  refundDailyQuota(userId, count = 1) {
    const normalizedCount = Math.max(1, Math.trunc(Number(count) || 1));
    const today = new Date().toISOString().slice(0, 10);
    this.db
      .prepare(
        `UPDATE users
         SET daily_usage_count = MAX(0, daily_usage_count - ?),
             total_messages = MAX(0, total_messages - ?),
             updated_at = ?
         WHERE id = ? AND daily_usage_date = ?`
      )
      .run(normalizedCount, normalizedCount, now(), String(userId), today);
    const user = this.findUser(userId);
    if (user) {
      this.db
        .prepare(
          `INSERT INTO daily_credit_usage(user_id, credit_type, usage_date, used, updated_at)
           VALUES (?, 'chat', ?, ?, ?)
           ON CONFLICT(user_id, credit_type, usage_date) DO UPDATE SET
             used = excluded.used,
             updated_at = excluded.updated_at`
        )
        .run(String(userId), today, Number(user.dailyUsageCount || 0), now());
    }
    return user;
  }

  setUserDailyUsage(userId, count = 0, date = new Date().toISOString().slice(0, 10)) {
    const normalizedCount = Math.max(0, Number(count) || 0);
    this.db
      .prepare('UPDATE users SET daily_usage_date = ?, daily_usage_count = ?, updated_at = ? WHERE id = ?')
      .run(String(date), normalizedCount, now(), String(userId));
    if (this.findUser(userId)) {
      this.db
        .prepare(
          `INSERT INTO daily_credit_usage(user_id, credit_type, usage_date, used, updated_at)
           VALUES (?, 'chat', ?, ?, ?)
           ON CONFLICT(user_id, credit_type, usage_date) DO UPDATE SET
             used = excluded.used,
             updated_at = excluded.updated_at`
        )
        .run(String(userId), String(date), normalizedCount, now());
    }
    this.setMeta('updatedAt', now());
    return this.findUser(userId);
  }

  resetDailyUsageForAll(date = new Date().toISOString().slice(0, 10)) {
    this.db
      .prepare('UPDATE users SET daily_usage_date = ?, daily_usage_count = 0, updated_at = ?')
      .run(String(date), now());
    this.db
      .prepare("DELETE FROM daily_credit_usage WHERE credit_type = 'chat' AND usage_date = ?")
      .run(String(date));
    this.setMeta('updatedAt', now());
  }

  createStarOrder({
    id = '',
    invoicePayload = '',
    userId,
    productId,
    currency = 'XTR',
    amount,
    grants = {},
    expiresAt = ''
  } = {}) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId || !this.findUser(normalizedUserId)) {
      throw new RangeError('A persisted user is required to create a Stars order.');
    }

    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) throw new RangeError('A product ID is required to create a Stars order.');

    const normalizedCurrency = String(currency || '').trim().toUpperCase();
    if (normalizedCurrency !== 'XTR') throw new RangeError('Telegram digital goods must use XTR currency.');

    const normalizedAmount = normalizeBillingUnits(amount, { label: 'Stars order amount' });
    const normalizedGrants = normalizeCreditGrants(grants);
    if (Object.keys(normalizedGrants).length === 0) {
      throw new RangeError('A Stars order must grant at least one credit.');
    }

    const orderId = String(id || randomUUID()).trim();
    const payload = String(invoicePayload || `stars:${orderId}`).trim();
    const payloadBytes = Buffer.byteLength(payload, 'utf8');
    if (payloadBytes < 1 || payloadBytes > 128) {
      throw new RangeError('Invoice payload must be between 1 and 128 UTF-8 bytes.');
    }

    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO star_orders(
           id, invoice_payload, user_id, product_id, currency, amount, grants_json, status,
           telegram_payment_charge_id, provider_payment_charge_id,
           created_at, expires_at, paid_at, refunded_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, '', ?, ?, '', '', ?)`
      )
      .run(
        orderId,
        payload,
        normalizedUserId,
        normalizedProductId,
        normalizedCurrency,
        normalizedAmount,
        JSON.stringify(normalizedGrants),
        timestamp,
        String(expiresAt || ''),
        timestamp
      );
    this.setMeta('updatedAt', timestamp);
    return this.getStarOrder(orderId);
  }

  getStarOrder(orderId) {
    return rowToStarOrder(
      this.db.prepare('SELECT * FROM star_orders WHERE id = ?').get(String(orderId || ''))
    );
  }

  findStarOrderByPayload(invoicePayload) {
    return rowToStarOrder(
      this.db.prepare('SELECT * FROM star_orders WHERE invoice_payload = ?').get(String(invoicePayload || ''))
    );
  }

  findStarOrderByChargeId(telegramPaymentChargeId) {
    return rowToStarOrder(
      this.db
        .prepare('SELECT * FROM star_orders WHERE telegram_payment_charge_id = ?')
        .get(String(telegramPaymentChargeId || ''))
    );
  }

  markStarOrderFailed(orderId) {
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) return { failed: false, order: null };
    const timestamp = now();
    const update = this.db
      .prepare("UPDATE star_orders SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'")
      .run(timestamp, normalizedOrderId);
    if (update.changes > 0) this.setMeta('updatedAt', timestamp);
    return { failed: update.changes > 0, order: this.getStarOrder(normalizedOrderId) };
  }

  listStarOrders({ userId = '', status = '', limit = 50, offset = 0 } = {}) {
    const filters = [];
    const args = [];
    if (userId !== '') {
      filters.push('user_id = ?');
      args.push(String(userId));
    }
    if (status) {
      filters.push('status = ?');
      args.push(String(status));
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 50)));
    const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
    return this.db
      .prepare(`SELECT * FROM star_orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...args, safeLimit, safeOffset)
      .map(rowToStarOrder);
  }

  validateStarOrderForCheckout({
    invoicePayload,
    userId,
    currency,
    totalAmount,
    at = now()
  } = {}) {
    const order = this.findStarOrderByPayload(invoicePayload);
    if (!order) return { ok: false, code: 'ORDER_NOT_FOUND', order: null };
    if (order.status !== 'pending') return { ok: false, code: 'ORDER_NOT_PENDING', order };
    if (order.userId !== String(userId || '')) return { ok: false, code: 'ORDER_USER_MISMATCH', order };
    if (String(currency || '').toUpperCase() !== 'XTR' || order.currency !== 'XTR') {
      return { ok: false, code: 'ORDER_CURRENCY_MISMATCH', order };
    }
    if (!Number.isSafeInteger(Number(totalAmount)) || order.amount !== Number(totalAmount)) {
      return { ok: false, code: 'ORDER_AMOUNT_MISMATCH', order };
    }
    if (order.expiresAt) {
      const expiresAt = Date.parse(order.expiresAt);
      const checkedAt = Date.parse(String(at || ''));
      if (Number.isFinite(expiresAt) && Number.isFinite(checkedAt) && expiresAt <= checkedAt) {
        return { ok: false, code: 'ORDER_EXPIRED', order };
      }
    }
    return { ok: true, code: 'OK', order };
  }

  applySuccessfulStarPayment({
    invoicePayload,
    userId,
    currency,
    totalAmount,
    telegramPaymentChargeId,
    providerPaymentChargeId = ''
  } = {}) {
    const normalizedPayload = String(invoicePayload || '').trim();
    const normalizedUserId = String(userId || '').trim();
    const normalizedCurrency = String(currency || '').trim().toUpperCase();
    const normalizedAmount = normalizeBillingUnits(totalAmount, { label: 'Successful payment amount' });
    const chargeId = String(telegramPaymentChargeId || '').trim();
    if (!normalizedPayload) throw new RangeError('Successful payment invoice payload is required.');
    if (!normalizedUserId) throw new RangeError('Successful payment user ID is required.');
    if (normalizedCurrency !== 'XTR') throw new RangeError('Successful payment currency must be XTR.');
    if (!chargeId) throw new RangeError('telegram_payment_charge_id is required.');

    return this.runImmediateTransaction(() => {
      const chargedOrder = rowToStarOrder(
        this.db.prepare('SELECT * FROM star_orders WHERE telegram_payment_charge_id = ?').get(chargeId)
      );
      if (chargedOrder) {
        const samePayment =
          chargedOrder.invoicePayload === normalizedPayload &&
          chargedOrder.userId === normalizedUserId &&
          chargedOrder.currency === normalizedCurrency &&
          chargedOrder.amount === normalizedAmount;
        return {
          credited: false,
          duplicate: samePayment,
          reason: samePayment ? 'PAYMENT_ALREADY_APPLIED' : 'PAYMENT_CHARGE_CONFLICT',
          order: chargedOrder,
          balances: this.getUserCreditBalances(chargedOrder.userId)
        };
      }

      const order = rowToStarOrder(
        this.db.prepare('SELECT * FROM star_orders WHERE invoice_payload = ?').get(normalizedPayload)
      );
      if (!order) {
        return { credited: false, duplicate: false, reason: 'ORDER_NOT_FOUND', order: null, balances: null };
      }
      if (order.userId !== normalizedUserId) {
        return { credited: false, duplicate: false, reason: 'ORDER_USER_MISMATCH', order, balances: null };
      }
      if (order.currency !== normalizedCurrency) {
        return { credited: false, duplicate: false, reason: 'ORDER_CURRENCY_MISMATCH', order, balances: null };
      }
      if (order.amount !== normalizedAmount) {
        return { credited: false, duplicate: false, reason: 'ORDER_AMOUNT_MISMATCH', order, balances: null };
      }
      if (!['pending', 'failed'].includes(order.status)) {
        return {
          credited: false,
          duplicate: false,
          reason: 'ORDER_NOT_PENDING',
          order,
          balances: this.getUserCreditBalances(order.userId)
        };
      }

      const timestamp = now();
      const update = this.db
        .prepare(
          `UPDATE star_orders
           SET status = 'paid', telegram_payment_charge_id = ?, provider_payment_charge_id = ?,
               paid_at = ?, updated_at = ?
           WHERE id = ? AND status IN ('pending', 'failed') AND telegram_payment_charge_id IS NULL`
        )
        .run(chargeId, String(providerPaymentChargeId || ''), timestamp, timestamp, order.id);
      if (update.changes !== 1) {
        throw new Error('Stars order changed while payment was being applied.');
      }

      for (const [creditType, units] of Object.entries(order.grants)) {
        this.db
          .prepare(
            `INSERT INTO user_credit_balances(user_id, credit_type, balance, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, credit_type) DO UPDATE SET
               balance = user_credit_balances.balance + excluded.balance,
               updated_at = excluded.updated_at`
          )
          .run(order.userId, creditType, units, timestamp);
      }

      this.setMeta('updatedAt', timestamp);
      const paidOrder = rowToStarOrder(this.db.prepare('SELECT * FROM star_orders WHERE id = ?').get(order.id));
      return {
        credited: true,
        duplicate: false,
        reason: 'PAYMENT_APPLIED',
        order: paidOrder,
        balances: this.getUserCreditBalances(order.userId)
      };
    });
  }

  getCreditBalance(userId, creditType) {
    const normalizedType = normalizeBillingCreditType(creditType);
    const row = this.db
      .prepare('SELECT balance, updated_at FROM user_credit_balances WHERE user_id = ? AND credit_type = ?')
      .get(String(userId || ''), normalizedType);
    return {
      userId: String(userId || ''),
      creditType: normalizedType,
      balance: Number(row?.balance || 0),
      updatedAt: row?.updated_at || ''
    };
  }

  getUserCreditBalances(userId) {
    const normalizedUserId = String(userId || '');
    const rows = this.db
      .prepare('SELECT credit_type, balance, updated_at FROM user_credit_balances WHERE user_id = ?')
      .all(normalizedUserId);
    const balances = Object.fromEntries(BILLING_CREDIT_TYPES.map((creditType) => [creditType, 0]));
    let updatedAt = '';
    for (const row of rows) {
      balances[row.credit_type] = Number(row.balance || 0);
      if (String(row.updated_at || '') > updatedAt) updatedAt = row.updated_at;
    }
    return { userId: normalizedUserId, ...balances, balances, updatedAt };
  }

  getCreditBalances(userId) {
    return this.getUserCreditBalances(userId);
  }

  logCreditBalanceAudit(audit, { userId, operation, beforeBalances, afterBalances, changes }) {
    if (!audit || typeof audit !== 'object') return;
    this.logAudit({
      actorId: audit.actorId || '',
      actorType: audit.actorType || 'system',
      action: audit.action || `users.credits.${operation}`,
      targetType: 'user',
      targetId: String(userId),
      result: audit.result || 'allow',
      requestId: audit.requestId || '',
      ip: audit.ip || '',
      userAgent: audit.userAgent || '',
      details: {
        ...(audit.details && typeof audit.details === 'object' && !Array.isArray(audit.details)
          ? audit.details
          : {}),
        operation,
        beforeBalances,
        afterBalances,
        changes
      }
    });
  }

  setUserCreditBalances(userId, balances = {}, { audit = null, requireAll = false } = {}) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      throw createCreditBalanceError('USER_NOT_FOUND', 'A persisted user is required.');
    }
    const normalizedBalances = normalizeCreditBalanceValues(balances, { requireAll });

    return this.runImmediateTransaction(() => {
      if (!this.findUser(normalizedUserId)) {
        throw createCreditBalanceError('USER_NOT_FOUND', 'A persisted user is required.');
      }

      const beforeBalances = this.getUserCreditBalances(normalizedUserId).balances;
      const timestamp = now();
      const upsert = this.db.prepare(
        `INSERT INTO user_credit_balances(user_id, credit_type, balance, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, credit_type) DO UPDATE SET
           balance = excluded.balance,
           updated_at = excluded.updated_at`
      );
      for (const [creditType, balance] of Object.entries(normalizedBalances)) {
        upsert.run(normalizedUserId, creditType, balance, timestamp);
      }

      const after = this.getUserCreditBalances(normalizedUserId);
      const changes = {};
      for (const creditType of Object.keys(normalizedBalances)) {
        const previous = beforeBalances[creditType];
        const next = after.balances[creditType];
        if (previous !== next) changes[creditType] = { before: previous, after: next, delta: next - previous };
      }
      this.setMeta('updatedAt', timestamp);
      this.logCreditBalanceAudit(audit, {
        userId: normalizedUserId,
        operation: 'set',
        beforeBalances,
        afterBalances: after.balances,
        changes
      });
      return {
        userId: normalizedUserId,
        operation: 'set',
        beforeBalances,
        balances: after.balances,
        changes,
        updatedAt: after.updatedAt
      };
    });
  }

  adjustUserCreditBalances(userId, adjustments = {}, { audit = null } = {}) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      throw createCreditBalanceError('USER_NOT_FOUND', 'A persisted user is required.');
    }
    const normalizedAdjustments = normalizeCreditBalanceValues(adjustments, { allowNegative: true });

    return this.runImmediateTransaction(() => {
      if (!this.findUser(normalizedUserId)) {
        throw createCreditBalanceError('USER_NOT_FOUND', 'A persisted user is required.');
      }

      const beforeBalances = this.getUserCreditBalances(normalizedUserId).balances;
      const nextBalances = {};
      for (const [creditType, delta] of Object.entries(normalizedAdjustments)) {
        const next = beforeBalances[creditType] + delta;
        if (!Number.isSafeInteger(next)) {
          throw createCreditBalanceError(
            'CREDIT_BALANCE_OVERFLOW',
            `The ${creditType} balance would exceed the safe integer range.`
          );
        }
        if (next < 0) {
          throw createCreditBalanceError(
            'CREDIT_BALANCE_BELOW_ZERO',
            `The ${creditType} balance cannot be adjusted below zero.`
          );
        }
        nextBalances[creditType] = next;
      }

      const timestamp = now();
      const upsert = this.db.prepare(
        `INSERT INTO user_credit_balances(user_id, credit_type, balance, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, credit_type) DO UPDATE SET
           balance = excluded.balance,
           updated_at = excluded.updated_at`
      );
      for (const [creditType, balance] of Object.entries(nextBalances)) {
        upsert.run(normalizedUserId, creditType, balance, timestamp);
      }

      const after = this.getUserCreditBalances(normalizedUserId);
      const changes = {};
      for (const [creditType, delta] of Object.entries(normalizedAdjustments)) {
        if (delta !== 0) {
          changes[creditType] = {
            before: beforeBalances[creditType],
            after: after.balances[creditType],
            delta
          };
        }
      }
      this.setMeta('updatedAt', timestamp);
      this.logCreditBalanceAudit(audit, {
        userId: normalizedUserId,
        operation: 'adjust',
        beforeBalances,
        afterBalances: after.balances,
        changes
      });
      return {
        userId: normalizedUserId,
        operation: 'adjust',
        beforeBalances,
        balances: after.balances,
        changes,
        updatedAt: after.updatedAt
      };
    });
  }

  getDailyCreditUsage(userId, creditType, date = new Date().toISOString().slice(0, 10)) {
    const normalizedUserId = String(userId || '');
    const normalizedType = normalizeBillingCreditType(creditType);
    const normalizedDate = String(date || '');
    const row = this.db
      .prepare(
        'SELECT used, updated_at FROM daily_credit_usage WHERE user_id = ? AND credit_type = ? AND usage_date = ?'
      )
      .get(normalizedUserId, normalizedType, normalizedDate);
    const user = normalizedType === 'chat' ? this.findUser(normalizedUserId) : null;
    const legacyChatUsage = user?.dailyUsageDate === normalizedDate ? Number(user.dailyUsageCount || 0) : 0;
    return {
      userId: normalizedUserId,
      creditType: normalizedType,
      date: normalizedDate,
      used: Math.max(Number(row?.used || 0), legacyChatUsage),
      updatedAt: row?.updated_at || ''
    };
  }

  getUsageRecord(idOrRequestKey) {
    const identifier = String(idOrRequestKey || '');
    return rowToUsageRecord(
      this.db
        .prepare('SELECT * FROM usage_records WHERE id = ? OR request_key = ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1')
        .get(identifier, identifier, identifier)
    );
  }

  listUsageRecords({ userId = '', creditType = '', status = '', limit = 50, offset = 0 } = {}) {
    const filters = [];
    const args = [];
    if (userId !== '') {
      filters.push('user_id = ?');
      args.push(String(userId));
    }
    if (creditType) {
      filters.push('credit_type = ?');
      args.push(normalizeBillingCreditType(creditType));
    }
    if (status) {
      filters.push('status = ?');
      args.push(String(status));
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 50)));
    const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
    return this.db
      .prepare(`SELECT * FROM usage_records ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...args, safeLimit, safeOffset)
      .map(rowToUsageRecord);
  }

  reserveUsage({
    userId,
    creditType = 'chat',
    units = 1,
    requestKey = '',
    dailyFreeQuota = 0,
    isAdmin = false,
    usageDate = new Date().toISOString().slice(0, 10),
    metadata = {},
    zeroFreeQuotaMeansUnlimited = false
  } = {}) {
    const normalizedUserId = String(userId || '').trim();
    const normalizedType = normalizeBillingCreditType(creditType);
    const normalizedUnits = normalizeBillingUnits(units);
    const normalizedRequestKey = String(requestKey || `usage:${randomUUID()}`).trim();
    const normalizedDate = String(usageDate || '').trim();
    const normalizedFreeQuota = normalizeBillingUnits(dailyFreeQuota, {
      allowZero: true,
      label: 'Daily free quota'
    });
    const metadataJson = JSON.stringify(parseJsonObject(metadata));
    if (!normalizedUserId) throw new RangeError('Usage reservation user ID is required.');
    if (!normalizedRequestKey) throw new RangeError('Usage reservation request key is required.');
    if (!normalizedDate) throw new RangeError('Usage reservation date is required.');

    return this.runImmediateTransaction(() => {
      const existing = rowToUsageRecord(
        this.db.prepare('SELECT * FROM usage_records WHERE request_key = ?').get(normalizedRequestKey)
      );
      if (existing) {
        return {
          // One request key has exactly one owner. Concurrent/retried Telegram
          // updates are suppressed instead of running a second paid action.
          // The specific state lets callers avoid misreporting this as an
          // insufficient-balance error.
          allowed: false,
          duplicate: true,
          inProgress: existing.status === 'reserved',
          completed: existing.status === 'consumed',
          reason: existing.status === 'consumed'
            ? 'USAGE_ALREADY_COMMITTED'
            : existing.status === 'reserved'
              ? 'USAGE_ALREADY_RESERVED'
              : 'USAGE_ALREADY_REFUNDED',
          record: existing,
          balance: this.getCreditBalance(existing.userId, existing.creditType).balance,
          freeRemaining: null
        };
      }

      const user = this.findUser(normalizedUserId);
      if (!user) {
        return {
          allowed: false,
          duplicate: false,
          reason: 'USER_NOT_FOUND',
          record: null,
          balance: 0,
          freeRemaining: 0
        };
      }

      const balanceState = this.getCreditBalance(normalizedUserId, normalizedType);
      const timestamp = now();
      let freeQuota = normalizedFreeQuota;
      let unlimitedFree = Boolean(zeroFreeQuotaMeansUnlimited && freeQuota === 0);
      if (normalizedType === 'chat') {
        const quota = this.getUserDailyQuota(normalizedUserId, normalizedFreeQuota);
        if (quota?.dailyQuotaOverride != null) {
          freeQuota = quota.dailyQuotaOverride;
          unlimitedFree = freeQuota === 0;
        }
      }

      const daily = this.getDailyCreditUsage(normalizedUserId, normalizedType, normalizedDate);
      const canUseDailyFree = unlimitedFree || (freeQuota > 0 && daily.used + normalizedUnits <= freeQuota);
      let source = '';
      let balanceAfter = balanceState.balance;
      let freeRemaining = unlimitedFree ? Infinity : Math.max(0, freeQuota - daily.used);

      if (isAdmin) {
        source = 'admin';
        freeRemaining = Infinity;
      } else if (canUseDailyFree) {
        source = 'daily_free';
        const nextUsed = daily.used + normalizedUnits;
        this.db
          .prepare(
            `INSERT INTO daily_credit_usage(user_id, credit_type, usage_date, used, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id, credit_type, usage_date) DO UPDATE SET
               used = excluded.used,
               updated_at = excluded.updated_at`
          )
          .run(normalizedUserId, normalizedType, normalizedDate, nextUsed, timestamp);
        if (normalizedType === 'chat') {
          this.db
            .prepare(
              `UPDATE users
               SET daily_usage_date = ?, daily_usage_count = ?,
                   total_messages = total_messages + ?, updated_at = ?
               WHERE id = ?`
            )
            .run(normalizedDate, nextUsed, normalizedUnits, timestamp, normalizedUserId);
        }
        freeRemaining = unlimitedFree ? Infinity : Math.max(0, freeQuota - nextUsed);
      } else {
        if (balanceState.balance < normalizedUnits) {
          return {
            allowed: false,
            duplicate: false,
            reason: 'INSUFFICIENT_CREDITS',
            record: null,
            balance: balanceState.balance,
            freeRemaining
          };
        }
        source = 'paid';
        balanceAfter = balanceState.balance - normalizedUnits;
        const debit = this.db
          .prepare(
            `UPDATE user_credit_balances
             SET balance = balance - ?, updated_at = ?
             WHERE user_id = ? AND credit_type = ? AND balance >= ?`
          )
          .run(normalizedUnits, timestamp, normalizedUserId, normalizedType, normalizedUnits);
        if (debit.changes !== 1) throw new Error('Credit balance changed while usage was being reserved.');
      }

      const recordId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO usage_records(
             id, request_key, user_id, credit_type, units, source, status,
             balance_before, balance_after, usage_date, metadata_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          recordId,
          normalizedRequestKey,
          normalizedUserId,
          normalizedType,
          normalizedUnits,
          source,
          balanceState.balance,
          balanceAfter,
          normalizedDate,
          metadataJson,
          timestamp,
          timestamp
        );
      this.setMeta('updatedAt', timestamp);
      return {
        allowed: true,
        duplicate: false,
        reason: source === 'admin' ? 'ADMIN_FREE' : source === 'daily_free' ? 'DAILY_FREE' : 'PAID_CREDIT',
        record: rowToUsageRecord(this.db.prepare('SELECT * FROM usage_records WHERE id = ?').get(recordId)),
        balance: balanceAfter,
        freeRemaining
      };
    });
  }

  commitUsage(idOrRequestKey) {
    const identifier = String(idOrRequestKey || '').trim();
    if (!identifier) return { committed: false, duplicate: false, reason: 'USAGE_NOT_FOUND', record: null };
    return this.runImmediateTransaction(() => {
      const record = this.getUsageRecord(identifier);
      if (!record) return { committed: false, duplicate: false, reason: 'USAGE_NOT_FOUND', record: null };
      if (record.status === 'consumed') {
        return { committed: false, duplicate: true, reason: 'USAGE_ALREADY_COMMITTED', record };
      }
      if (record.status === 'refunded') {
        return { committed: false, duplicate: false, reason: 'USAGE_ALREADY_REFUNDED', record };
      }
      const timestamp = now();
      this.db
        .prepare("UPDATE usage_records SET status = 'consumed', updated_at = ? WHERE id = ? AND status = 'reserved'")
        .run(timestamp, record.id);
      this.setMeta('updatedAt', timestamp);
      return { committed: true, duplicate: false, reason: 'USAGE_COMMITTED', record: this.getUsageRecord(record.id) };
    });
  }

  refundUsage(idOrRequestKey) {
    const identifier = String(idOrRequestKey || '').trim();
    if (!identifier) return { refunded: false, duplicate: false, reason: 'USAGE_NOT_FOUND', record: null };
    return this.runImmediateTransaction(() => {
      const record = this.getUsageRecord(identifier);
      if (!record) return { refunded: false, duplicate: false, reason: 'USAGE_NOT_FOUND', record: null };
      if (record.status === 'refunded') {
        return { refunded: false, duplicate: true, reason: 'USAGE_ALREADY_REFUNDED', record };
      }
      if (record.status === 'consumed') {
        return { refunded: false, duplicate: false, reason: 'USAGE_ALREADY_COMMITTED', record };
      }

      const timestamp = now();
      let restoredBalance = this.getCreditBalance(record.userId, record.creditType).balance;
      if (record.source === 'paid') {
        restoredBalance += record.units;
        this.db
          .prepare(
            `INSERT INTO user_credit_balances(user_id, credit_type, balance, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, credit_type) DO UPDATE SET
               balance = user_credit_balances.balance + excluded.balance,
               updated_at = excluded.updated_at`
          )
          .run(record.userId, record.creditType, record.units, timestamp);
      } else if (record.source === 'daily_free') {
        this.db
          .prepare(
            `UPDATE daily_credit_usage
             SET used = MAX(0, used - ?), updated_at = ?
             WHERE user_id = ? AND credit_type = ? AND usage_date = ?`
          )
          .run(record.units, timestamp, record.userId, record.creditType, record.usageDate);
        if (record.creditType === 'chat') {
          this.db
            .prepare(
              `UPDATE users
               SET daily_usage_count = MAX(0, daily_usage_count - ?),
                   total_messages = MAX(0, total_messages - ?), updated_at = ?
               WHERE id = ? AND daily_usage_date = ?`
            )
            .run(record.units, record.units, timestamp, record.userId, record.usageDate);
        }
      }

      this.db
        .prepare(
          `UPDATE usage_records
           SET status = 'refunded', balance_after = ?, updated_at = ?
           WHERE id = ? AND status != 'refunded'`
        )
        .run(restoredBalance, timestamp, record.id);
      this.setMeta('updatedAt', timestamp);
      return {
        refunded: true,
        duplicate: false,
        reason: 'USAGE_REFUNDED',
        record: this.getUsageRecord(record.id),
        balance: restoredBalance
      };
    });
  }

  refundStaleUsageReservations({ olderThanMs = 15 * 60 * 1000, limit = 1000 } = {}) {
    const safeAgeMs = Math.max(60 * 1000, Number(olderThanMs) || 15 * 60 * 1000);
    const safeLimit = Math.max(1, Math.min(5000, Math.trunc(Number(limit) || 1000)));
    const cutoff = new Date(Date.now() - safeAgeMs).toISOString();
    const stale = this.db
      .prepare(
        `SELECT id FROM usage_records
         WHERE status = 'reserved' AND updated_at <= ?
         ORDER BY updated_at ASC
         LIMIT ?`
      )
      .all(cutoff, safeLimit);
    let refunded = 0;
    for (const row of stale) {
      if (this.refundUsage(row.id).refunded) refunded += 1;
    }
    return { scanned: stale.length, refunded, cutoff };
  }

  getStarRefund(idOrChargeId) {
    const identifier = String(idOrChargeId || '');
    return rowToStarRefund(
      this.db
        .prepare(
          `SELECT * FROM star_refunds
           WHERE id = ? OR telegram_payment_charge_id = ?
           ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
           LIMIT 1`
        )
        .get(identifier, identifier, identifier)
    );
  }

  beginStarRefund({
    telegramPaymentChargeId,
    requestedBy = '',
    reason = '',
    leaseDurationMs = 5 * 60 * 1000,
    at = now()
  } = {}) {
    const chargeId = String(telegramPaymentChargeId || '').trim();
    if (!chargeId) throw new RangeError('telegram_payment_charge_id is required for a Stars refund.');
    const timestamp = String(at || now());
    const timestampMs = Number.isFinite(Date.parse(timestamp)) ? Date.parse(timestamp) : Date.now();
    const safeLeaseDurationMs = Math.max(30_000, Number(leaseDurationMs) || 5 * 60 * 1000);
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(timestampMs + safeLeaseDurationMs).toISOString();

    return this.runImmediateTransaction(() => {
      const order = rowToStarOrder(
        this.db.prepare('SELECT * FROM star_orders WHERE telegram_payment_charge_id = ?').get(chargeId)
      );
      if (!order) {
        return { ok: false, allowed: false, duplicate: false, reason: 'ORDER_NOT_FOUND', order: null, refund: null };
      }

      const existing = this.getStarRefund(chargeId);
      if (existing?.status === 'pending') {
        const currentLeaseExpiresAt = Date.parse(existing.leaseExpiresAt || '');
        if (existing.leaseToken && Number.isFinite(currentLeaseExpiresAt) && currentLeaseExpiresAt > timestampMs) {
          return {
            ok: true,
            allowed: false,
            id: existing.id,
            duplicate: true,
            inProgress: true,
            reason: 'REFUND_IN_PROGRESS',
            order,
            refund: existing
          };
        }
        this.db
          .prepare(
            `UPDATE star_refunds
             SET lease_token = ?, lease_expires_at = ?, requested_by = ?, updated_at = ?
             WHERE id = ? AND status = 'pending'`
          )
          .run(leaseToken, leaseExpiresAt, String(requestedBy || ''), timestamp, existing.id);
        return {
          ok: true,
          allowed: true,
          id: existing.id,
          duplicate: true,
          leaseToken,
          reason: 'REFUND_RETRY_PENDING',
          order,
          refund: this.getStarRefund(existing.id)
        };
      }
      if (existing?.status === 'succeeded' || order.status === 'refunded') {
        return {
          ok: true,
          allowed: true,
          id: existing?.id || '',
          duplicate: true,
          reason: 'REFUND_ALREADY_COMPLETED',
          order,
          refund: existing
        };
      }
      if (order.status !== 'paid') {
        return {
          ok: false,
          allowed: false,
          duplicate: false,
          reason: 'ORDER_NOT_REFUNDABLE',
          order,
          refund: existing
        };
      }

      for (const [creditType, units] of Object.entries(order.grants)) {
        const balance = this.getCreditBalance(order.userId, creditType).balance;
        if (balance < units) {
          return {
            ok: false,
            allowed: false,
            duplicate: false,
            reason: 'ORDER_CREDITS_ALREADY_USED',
            order,
            refund: existing,
            creditType,
            required: units,
            available: balance
          };
        }
      }

      for (const [creditType, units] of Object.entries(order.grants)) {
        const debit = this.db
          .prepare(
            `UPDATE user_credit_balances
             SET balance = balance - ?, updated_at = ?
             WHERE user_id = ? AND credit_type = ? AND balance >= ?`
          )
          .run(units, timestamp, order.userId, creditType, units);
        if (debit.changes !== 1) throw new Error('Credit balance changed while refund was being prepared.');
      }

      const refundId = existing?.id || randomUUID();
      this.db
        .prepare(
          `INSERT INTO star_refunds(
             id, order_id, telegram_payment_charge_id, status, requested_by, reason, error,
             revoked_grants_json, lease_token, lease_expires_at, created_at, updated_at
           ) VALUES (?, ?, ?, 'pending', ?, ?, '', ?, ?, ?, ?, ?)
           ON CONFLICT(order_id) DO UPDATE SET
             status = 'pending',
             requested_by = excluded.requested_by,
             reason = excluded.reason,
             error = '',
             revoked_grants_json = excluded.revoked_grants_json,
             lease_token = excluded.lease_token,
             lease_expires_at = excluded.lease_expires_at,
             updated_at = excluded.updated_at`
        )
        .run(
          refundId,
          order.id,
          chargeId,
          String(requestedBy || ''),
          String(reason || ''),
          JSON.stringify(order.grants),
          leaseToken,
          leaseExpiresAt,
          existing?.createdAt || timestamp,
          timestamp
        );
      this.db
        .prepare("UPDATE star_orders SET status = 'refund_pending', updated_at = ? WHERE id = ? AND status = 'paid'")
        .run(timestamp, order.id);
      this.setMeta('updatedAt', timestamp);
      return {
        ok: true,
        allowed: true,
        id: refundId,
        leaseToken,
        duplicate: false,
        reason: 'REFUND_PENDING',
        order: rowToStarOrder(this.db.prepare('SELECT * FROM star_orders WHERE id = ?').get(order.id)),
        refund: this.getStarRefund(refundId),
        balances: this.getUserCreditBalances(order.userId)
      };
    });
  }

  completeStarRefund(idOrChargeId, leaseToken = '') {
    const identifier = String(idOrChargeId || '').trim();
    if (!identifier) return { completed: false, duplicate: false, reason: 'REFUND_NOT_FOUND', refund: null };
    return this.runImmediateTransaction(() => {
      const refund = this.getStarRefund(identifier);
      if (!refund) return { completed: false, duplicate: false, reason: 'REFUND_NOT_FOUND', refund: null };
      if (refund.status === 'succeeded') {
        return { completed: false, duplicate: true, reason: 'REFUND_ALREADY_COMPLETED', refund };
      }
      if (refund.status !== 'pending') {
        return { completed: false, duplicate: false, reason: 'REFUND_NOT_PENDING', refund };
      }
      if (!refund.leaseToken || refund.leaseToken !== String(leaseToken || '')) {
        return { completed: false, duplicate: false, reason: 'REFUND_LEASE_MISMATCH', refund };
      }
      const timestamp = now();
      this.db
        .prepare("UPDATE star_refunds SET status = 'succeeded', error = '', lease_token = '', lease_expires_at = '', updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(timestamp, refund.id);
      this.db
        .prepare(
          `UPDATE star_orders
           SET status = 'refunded', refunded_at = ?, updated_at = ?
           WHERE id = ? AND status = 'refund_pending'`
        )
        .run(timestamp, timestamp, refund.orderId);
      this.setMeta('updatedAt', timestamp);
      return {
        completed: true,
        duplicate: false,
        reason: 'REFUND_COMPLETED',
        refund: this.getStarRefund(refund.id),
        order: this.getStarOrder(refund.orderId)
      };
    });
  }

  failStarRefund(idOrChargeId, error = '', leaseToken = '') {
    const identifier = String(idOrChargeId || '').trim();
    if (!identifier) return { failed: false, duplicate: false, reason: 'REFUND_NOT_FOUND', refund: null };
    return this.runImmediateTransaction(() => {
      const refund = this.getStarRefund(identifier);
      if (!refund) return { failed: false, duplicate: false, reason: 'REFUND_NOT_FOUND', refund: null };
      if (refund.status === 'failed') {
        return { failed: false, duplicate: true, reason: 'REFUND_ALREADY_FAILED', refund };
      }
      if (refund.status !== 'pending') {
        return { failed: false, duplicate: false, reason: 'REFUND_NOT_PENDING', refund };
      }
      if (!refund.leaseToken || refund.leaseToken !== String(leaseToken || '')) {
        return { failed: false, duplicate: false, reason: 'REFUND_LEASE_MISMATCH', refund };
      }
      const order = this.getStarOrder(refund.orderId);
      const timestamp = now();
      for (const [creditType, units] of Object.entries(refund.revokedGrants)) {
        this.db
          .prepare(
            `INSERT INTO user_credit_balances(user_id, credit_type, balance, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id, credit_type) DO UPDATE SET
               balance = user_credit_balances.balance + excluded.balance,
               updated_at = excluded.updated_at`
          )
          .run(order.userId, creditType, units, timestamp);
      }
      this.db
        .prepare("UPDATE star_refunds SET status = 'failed', error = ?, lease_token = '', lease_expires_at = '', updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(String(error || ''), timestamp, refund.id);
      this.db
        .prepare("UPDATE star_orders SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'refund_pending'")
        .run(timestamp, refund.orderId);
      this.setMeta('updatedAt', timestamp);
      return {
        failed: true,
        duplicate: false,
        reason: 'REFUND_FAILED_AND_CREDITS_RESTORED',
        refund: this.getStarRefund(refund.id),
        order: this.getStarOrder(refund.orderId),
        balances: this.getUserCreditBalances(order.userId)
      };
    });
  }

  getOperationsMetrics() {
    const stats = this.getStats();
    const activeUsersRow = this.db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE last_seen_at >= datetime('now', '-7 day')")
      .get();
    const quotaRow = this.db
      .prepare('SELECT COALESCE(SUM(daily_usage_count), 0) AS total FROM users WHERE daily_usage_date = ?')
      .get(new Date().toISOString().slice(0, 10));
    const modelRows = this.db
      .prepare(
        `SELECT model, COUNT(*) AS count
         FROM message_versions
         WHERE is_current = 1 AND model != ''
         GROUP BY model
         ORDER BY count DESC
         LIMIT 20`
      )
      .all();
    return {
      stats,
      activeUsers7d: Number(activeUsersRow?.count || 0),
      quotaConsumedToday: Number(quotaRow?.total || 0),
      modelDistribution: modelRows.map((row) => ({ model: row.model, count: Number(row.count || 0) }))
    };
  }
  getMemoryItems({ userId = '', chatId = '', topicId = '', limit = 20 } = {}) {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, chat_id, topic_id, memory_type, key, value, confidence, source, created_at, updated_at
         FROM memory_items
         WHERE user_id = ?
           AND (chat_id = ? OR chat_id = '')
           AND (topic_id = ? OR topic_id = '')
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(String(userId || ''), String(chatId || ''), String(topicId || ''), Number(limit || 20));

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      topicId: row.topic_id,
      memoryType: row.memory_type,
      key: row.key,
      value: row.value,
      confidence: row.confidence,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  upsertMemoryItem({
    id = '',
    userId = '',
    chatId = '',
    topicId = '',
    memoryType = 'fact',
    key = '',
    value = '',
    confidence = 0.8,
    source = ''
  } = {}) {
    const timestamp = now();
    const resolvedId = id || `mem:${String(userId || 'global')}:${String(chatId || 'global')}:${String(topicId || 'global')}:${String(key || randomUUID())}`;

    this.db
      .prepare(
        `INSERT INTO memory_items (
           id, user_id, chat_id, topic_id, memory_type, key, value, confidence, source, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           memory_type = excluded.memory_type,
           key = excluded.key,
           value = excluded.value,
           confidence = excluded.confidence,
           source = excluded.source,
           updated_at = excluded.updated_at`
      )
      .run(
        resolvedId,
        String(userId || ''),
        String(chatId || ''),
        String(topicId || ''),
        String(memoryType || 'fact'),
        String(key || ''),
        String(value || ''),
        Number(confidence || 0.8),
        String(source || ''),
        timestamp,
        timestamp
      );

    this.setMeta('updatedAt', timestamp);
    return resolvedId;
  }

  getTopicState({ userId = '', chatId = '', topicId = '' } = {}) {
    const row = this.db
      .prepare(
        `SELECT id, user_id, chat_id, topic_id, title, summary, current_goal, last_step, next_step,
                status, last_accessed_at, created_at, updated_at
         FROM topic_states
         WHERE user_id = ? AND chat_id = ? AND topic_id = ?
         LIMIT 1`
      )
      .get(String(userId || ''), String(chatId || ''), String(topicId || ''));

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      topicId: row.topic_id,
      title: row.title,
      summary: row.summary,
      currentGoal: row.current_goal,
      lastStep: row.last_step,
      nextStep: row.next_step,
      status: row.status,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  listRecentTopicStates({ userId = '', chatId = '', limit = 8 } = {}) {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, chat_id, topic_id, title, summary, current_goal, last_step, next_step,
                status, last_accessed_at, created_at, updated_at
         FROM topic_states
         WHERE user_id = ? AND chat_id = ? AND status = 'active'
         ORDER BY last_accessed_at DESC
         LIMIT ?`
      )
      .all(String(userId || ''), String(chatId || ''), Number(limit || 8));

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      topicId: row.topic_id,
      title: row.title,
      summary: row.summary,
      currentGoal: row.current_goal,
      lastStep: row.last_step,
      nextStep: row.next_step,
      status: row.status,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  upsertTopicState({
    userId = '',
    chatId = '',
    topicId = 'general',
    title = '',
    summary = '',
    currentGoal = '',
    lastStep = '',
    nextStep = '',
    status = 'active'
  } = {}) {
    const timestamp = now();
    const id = `topic:${String(userId || 'global')}:${String(chatId || 'global')}:${String(topicId || 'general')}`;

    this.db
      .prepare(
        `INSERT INTO topic_states (
           id, user_id, chat_id, topic_id, title, summary, current_goal, last_step, next_step,
           status, last_accessed_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           summary = excluded.summary,
           current_goal = excluded.current_goal,
           last_step = excluded.last_step,
           next_step = excluded.next_step,
           status = excluded.status,
           last_accessed_at = excluded.last_accessed_at,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        String(userId || ''),
        String(chatId || ''),
        String(topicId || 'general'),
        String(title || ''),
        String(summary || ''),
        String(currentGoal || ''),
        String(lastStep || ''),
        String(nextStep || ''),
        String(status || 'active'),
        timestamp,
        timestamp,
        timestamp
      );

    this.setMeta('updatedAt', timestamp);
    return id;
  }

  getActiveContext({ userId = '', chatId = '' } = {}) {
    const row = this.db
      .prepare(
        `SELECT id, user_id, chat_id, active_topic_id, return_topic_id, updated_at
         FROM active_contexts
         WHERE user_id = ? AND chat_id = ?
         LIMIT 1`
      )
      .get(String(userId || ''), String(chatId || ''));

    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      activeTopicId: row.active_topic_id,
      returnTopicId: row.return_topic_id,
      updatedAt: row.updated_at
    };
  }

  setActiveContext({ userId = '', chatId = '', activeTopicId = '', returnTopicId = '' } = {}) {
    const timestamp = now();
    const id = `active:${String(userId || 'global')}:${String(chatId || 'global')}`;

    this.db
      .prepare(
        `INSERT INTO active_contexts (id, user_id, chat_id, active_topic_id, return_topic_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           active_topic_id = excluded.active_topic_id,
           return_topic_id = excluded.return_topic_id,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        String(userId || ''),
        String(chatId || ''),
        String(activeTopicId || ''),
        String(returnTopicId || ''),
        timestamp
      );

    this.setMeta('updatedAt', timestamp);
    return id;
  }


  deleteMemoryItems({ userId = '', chatId = '', topicId = '' } = {}) {
    const timestamp = now();

    const conditions = ['user_id = ?', 'chat_id = ?'];
    const args = [String(userId || ''), String(chatId || '')];

    if (topicId) {
      conditions.push('topic_id = ?');
      args.push(String(topicId));
    }

    const result = this.db
      .prepare(`DELETE FROM memory_items WHERE ${conditions.join(' AND ')}`)
      .run(...args);

    this.setMeta('updatedAt', timestamp);
    return result.changes || 0;
  }

  clearTopicStates({ userId = '', chatId = '', topicId = '' } = {}) {
    const timestamp = now();

    const conditions = ['user_id = ?', 'chat_id = ?'];
    const args = [String(userId || ''), String(chatId || '')];

    if (topicId) {
      conditions.push('topic_id = ?');
      args.push(String(topicId));
    }

    const result = this.db
      .prepare(`DELETE FROM topic_states WHERE ${conditions.join(' AND ')}`)
      .run(...args);

    this.setMeta('updatedAt', timestamp);
    return result.changes || 0;
  }

  clearActiveContext({ userId = '', chatId = '' } = {}) {
    const timestamp = now();
    const result = this.db
      .prepare('DELETE FROM active_contexts WHERE user_id = ? AND chat_id = ?')
      .run(String(userId || ''), String(chatId || ''));

    this.setMeta('updatedAt', timestamp);
    return result.changes || 0;
  }


}
