import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeLanguageCode } from './utils/telegram.js';

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

function mapPatchToColumns(patch, columnMap) {
  return Object.entries(patch)
    .filter(([key, value]) => columnMap[key] && value !== undefined)
    .map(([key, value]) => [columnMap[key], value]);
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

export class BotDatabase {
  constructor(filePath, legacyFilePath = '') {
    this.filePath = filePath;
    this.legacyFilePath = legacyFilePath && legacyFilePath !== filePath ? legacyFilePath : '';
    this.db = null;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
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

    const createdAt = this.getMeta('createdAt');
    if (!createdAt) {
      await this.importLegacyJsonIfNeeded();
      this.setMeta('createdAt', this.getMeta('createdAt') || now());
      this.ensureStatsRow(this.getStats().startedAt || now());
    }

    this.setMeta('updatedAt', now());
    this.ensureStatsRow(this.getStats().startedAt || now());
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

  getConversation(sessionId) {
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

  async setConversation(sessionId, messages) {
    const existing = this.db
      .prepare('SELECT created_at FROM conversations WHERE session_id = ?')
      .get(String(sessionId));
    const timestamp = now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO conversations(session_id, messages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(String(sessionId), JSON.stringify(messages || []), existing?.created_at || timestamp, timestamp);
    await this.write();
  }

  async clearConversation(sessionId) {
    this.db.prepare('DELETE FROM conversations WHERE session_id = ?').run(String(sessionId));
    await this.write();
  }

  findFavorite(chatId, userId, messageId) {
    return this.db
      .prepare('SELECT * FROM favorites WHERE chat_id = ? AND user_id = ? AND message_id = ?')
      .get(String(chatId), String(userId), String(messageId));
  }

  async saveFavorite({ chatId, userId, messageId, text, sourceText = '', model = '', locale = 'zh' }) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO favorites(
          chat_id, user_id, message_id, text, source_text, model, locale, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(chatId),
        String(userId),
        String(messageId),
        String(text || ''),
        String(sourceText || ''),
        String(model || ''),
        String(locale || 'zh'),
        now()
      );
    await this.write();
    return this.findFavorite(chatId, userId, messageId);
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
}
