import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { normalizeLanguageCode } from './utils/telegram.js';

const CURRENT_SCHEMA_VERSION = 3;

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

function rowToUser(row) {
  if (!row) return undefined;
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
    dailyUsageDate: row.daily_usage_date || '',
    dailyUsageCount: row.daily_usage_count || 0,
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

  findUser(userId) {
    return rowToUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(String(userId)));
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
        `SELECT *
         FROM users
         ${hasKeyword ? 'WHERE id LIKE ? OR username LIKE ? OR first_name LIKE ? OR last_name LIKE ?' : ''}
         ORDER BY last_seen_at DESC, updated_at DESC
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
    if (!user) return { allowed: false, remaining: 0 };

    const today = new Date().toISOString().slice(0, 10);
    let dailyUsageCount = user.dailyUsageCount;
    if (user.dailyUsageDate !== today) {
      dailyUsageCount = 0;
      this.db
        .prepare('UPDATE users SET daily_usage_date = ?, daily_usage_count = 0, updated_at = ? WHERE id = ?')
        .run(today, now(), String(userId));
    }

    if (quota > 0 && dailyUsageCount >= quota) {
      return { allowed: false, remaining: 0 };
    }

    this.db
      .prepare(
        `UPDATE users
         SET daily_usage_date = ?, daily_usage_count = daily_usage_count + 1, total_messages = total_messages + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(today, now(), String(userId));
    return {
      allowed: true,
      remaining: quota > 0 ? Math.max(0, quota - dailyUsageCount - 1) : Infinity
    };
  }

  setUserDailyUsage(userId, count = 0, date = new Date().toISOString().slice(0, 10)) {
    this.db
      .prepare('UPDATE users SET daily_usage_date = ?, daily_usage_count = ?, updated_at = ? WHERE id = ?')
      .run(String(date), Math.max(0, Number(count) || 0), now(), String(userId));
    this.setMeta('updatedAt', now());
    return this.findUser(userId);
  }

  resetDailyUsageForAll(date = new Date().toISOString().slice(0, 10)) {
    this.db
      .prepare('UPDATE users SET daily_usage_date = ?, daily_usage_count = 0, updated_at = ?')
      .run(String(date), now());
    this.setMeta('updatedAt', now());
  }

  getOperationsMetrics() {
    const stats = this.getStats();
    const activeUsersRow = this.db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE last_seen_at >= datetime('now', '-7 day')")
      .get();
    const quotaRow = this.db
      .prepare('SELECT COALESCE(SUM(daily_usage_count), 0) AS total FROM users')
      .get();
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
}
