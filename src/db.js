import fs from 'node:fs/promises';
import path from 'node:path';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
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

function now() {
  return new Date().toISOString();
}

export class BotDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.db = new Low(new JSONFile(filePath), structuredClone(defaultData));
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.db.read();
    this.db.data ||= structuredClone(defaultData);
    this.db.data.meta.createdAt ||= now();
    this.db.data.meta.updatedAt = now();
    this.db.data.stats.startedAt ||= now();
    await this.db.write();
  }

  async write() {
    this.db.data.meta.updatedAt = now();
    await this.db.write();
  }

  findUser(userId) {
    return this.db.data.users.find((item) => item.id === String(userId));
  }

  findChat(chatId) {
    return this.db.data.chats.find((item) => item.id === String(chatId));
  }

  async upsertUser(telegramUser, { isAdmin = false } = {}) {
    const id = String(telegramUser.id);
    let user = this.findUser(id);

    if (!user) {
      user = {
        id,
        username: telegramUser.username || '',
        firstName: telegramUser.first_name || '',
        lastName: telegramUser.last_name || '',
        isAdmin,
        isBlocked: false,
        isAllowed: false,
        preferredModel: '',
        preferredLanguage: normalizeLanguageCode(telegramUser.language_code, 'zh'),
        persona: 'default',
        customSystemPrompt: '',
        dailyUsageDate: '',
        dailyUsageCount: 0,
        totalMessages: 0,
        lastSeenAt: now(),
        createdAt: now(),
        updatedAt: now()
      };
      this.db.data.users.push(user);
    } else {
      user.username = telegramUser.username || user.username;
      user.firstName = telegramUser.first_name || user.firstName;
      user.lastName = telegramUser.last_name || user.lastName;
      user.isAdmin = user.isAdmin || isAdmin;
      user.preferredLanguage ||= normalizeLanguageCode(telegramUser.language_code, 'zh');
      user.lastSeenAt = now();
      user.updatedAt = now();
    }

    await this.write();
    return user;
  }

  async upsertChat(chat, defaults = {}) {
    const id = String(chat.id);
    let record = this.findChat(id);

    if (!record) {
      record = {
        id,
        type: chat.type,
        title: chat.title || '',
        username: chat.username || '',
        triggerMode: defaults.triggerMode || 'smart',
        keyword: defaults.keyword || 'ai',
        defaultModel: '',
        systemPrompt: '',
        createdAt: now(),
        updatedAt: now()
      };
      this.db.data.chats.push(record);
    } else {
      record.title = chat.title || record.title;
      record.username = chat.username || record.username;
      record.updatedAt = now();
    }

    await this.write();
    return record;
  }

  async setChatSettings(chatId, patch) {
    const chat = this.findChat(chatId);
    if (!chat) return null;
    Object.assign(chat, patch, { updatedAt: now() });
    await this.write();
    return chat;
  }

  async setUserSettings(userId, patch) {
    const user = this.findUser(userId);
    if (!user) return null;
    Object.assign(user, patch, { updatedAt: now() });
    await this.write();
    return user;
  }

  getConversation(sessionId) {
    const item = this.db.data.conversations.find((entry) => entry.sessionId === sessionId);
    return item?.messages ?? [];
  }

  async setConversation(sessionId, messages) {
    const existing = this.db.data.conversations.find((entry) => entry.sessionId === sessionId);
    if (existing) {
      existing.messages = messages;
      existing.updatedAt = now();
    } else {
      this.db.data.conversations.push({
        sessionId,
        messages,
        createdAt: now(),
        updatedAt: now()
      });
    }
    await this.write();
  }

  async clearConversation(sessionId) {
    this.db.data.conversations = this.db.data.conversations.filter((entry) => entry.sessionId !== sessionId);
    await this.write();
  }

  async incrementStats(key, by = 1) {
    this.db.data.stats[key] = (this.db.data.stats[key] || 0) + by;
    await this.write();
  }

  getStats() {
    return structuredClone(this.db.data.stats);
  }

  consumeDailyQuota(userId, quota) {
    const user = this.findUser(userId);
    if (!user) return { allowed: false, remaining: 0 };

    const today = new Date().toISOString().slice(0, 10);
    if (user.dailyUsageDate !== today) {
      user.dailyUsageDate = today;
      user.dailyUsageCount = 0;
    }

    if (quota > 0 && user.dailyUsageCount >= quota) {
      return { allowed: false, remaining: 0 };
    }

    user.dailyUsageCount += 1;
    user.totalMessages += 1;
    user.updatedAt = now();
    return {
      allowed: true,
      remaining: quota > 0 ? Math.max(0, quota - user.dailyUsageCount) : Infinity
    };
  }
}
