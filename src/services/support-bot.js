import { Telegraf } from 'telegraf';

const SUPPORT_TICKET_PATTERN = /^\[support-ticket:user=(\d{1,20})\]/m;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_MESSAGES = 5;
const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;

function createConfigurationError(code, message) {
  const error = new Error(message);
  error.name = 'SupportBotConfigurationError';
  error.code = code;
  return error;
}

function asPositiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function normalizeAdminIds(value) {
  const source = value instanceof Set
    ? Array.from(value)
    : Array.isArray(value)
      ? value
      : String(value || '').split(',');

  return Array.from(new Set(
    source
      .map((item) => String(item || '').trim())
      .filter((item) => /^\d{1,20}$/.test(item) && item !== '0')
  ));
}

function safeDisplayText(value = '', maxLength = 500) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isEnglishUser(user = {}) {
  return String(user.language_code || '').toLowerCase().startsWith('en');
}

function supportMessageType(message = {}) {
  if (message.photo?.length) return 'photo';
  if (message.voice) return 'voice';
  if (message.document) return 'document';
  if (typeof message.text === 'string') return 'text';
  return 'unsupported';
}

function parseSupportTicketUserId(message = {}) {
  const value = String(message.text || message.caption || '');
  return value.match(SUPPORT_TICKET_PATTERN)?.[1] || '';
}

function buildSupportTicketText({ user = {}, message = {}, now = new Date() } = {}) {
  const userId = String(user.id || '').trim();
  const username = safeDisplayText(user.username ? `@${user.username}` : '-', 80);
  const name = safeDisplayText([user.first_name, user.last_name].filter(Boolean).join(' ') || '-', 160);
  const type = supportMessageType(message);
  const content = safeDisplayText(message.text || message.caption || '', 3000);
  const lines = [
    `[support-ticket:user=${userId}]`,
    'Customer support request',
    `Telegram ID: ${userId}`,
    `Username: ${username}`,
    `Name: ${name}`,
    `Time: ${now.toISOString()}`,
    `Type: ${type}`
  ];
  if (content) lines.push('', 'Message:', content);
  return lines.join('\n');
}

function truncateTelegramText(value = '', limit = TELEGRAM_TEXT_LIMIT) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export class SupportTelegramBot {
  constructor({
    config = {},
    logger = null,
    telegrafFactory = (token) => new Telegraf(token),
    now = () => Date.now()
  } = {}) {
    this.config = config;
    this.logger = logger;
    this.now = now;
    this.adminIds = normalizeAdminIds(config.supportAdminIds);
    this.adminIdSet = new Set(this.adminIds);
    this.rateLimitWindowMs = asPositiveInteger(
      config.supportRateLimitWindowMs,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
      24 * 60 * 60 * 1000
    );
    this.rateLimitMaxMessages = asPositiveInteger(
      config.supportRateLimitMaxMessages,
      DEFAULT_RATE_LIMIT_MAX_MESSAGES,
      1000
    );
    this.rateLimitHits = new Map();
    this.bot = telegrafFactory(String(config.supportBotToken || '').trim());
    this.botInfo = null;
    this.initialized = false;
    this.launched = false;
  }

  validateConfiguration() {
    if (this.config.supportEnabled !== true) {
      throw createConfigurationError('SUPPORT_BOT_DISABLED', 'Support bot is disabled.');
    }

    const supportToken = String(this.config.supportBotToken || '').trim();
    if (!supportToken) {
      throw createConfigurationError('MISSING_SUPPORT_BOT_TOKEN', 'SUPPORT_BOT_TOKEN is required.');
    }

    const mainToken = String(this.config.botToken || '').trim();
    if (mainToken && supportToken === mainToken) {
      throw createConfigurationError(
        'SUPPORT_BOT_TOKEN_CONFLICT',
        'SUPPORT_BOT_TOKEN must be different from BOT_TOKEN.'
      );
    }

    if (this.adminIds.length === 0) {
      throw createConfigurationError('MISSING_SUPPORT_ADMIN_IDS', 'SUPPORT_ADMIN_IDS must contain at least one Telegram user ID.');
    }
  }

  async init() {
    if (this.initialized) return this;
    this.validateConfiguration();

    this.bot.start((ctx) => this.handleStart(ctx));
    this.bot.on('message', (ctx) => this.handleMessage(ctx));
    this.bot.catch((error, ctx) => {
      this.logger?.error?.('Support bot handler failed', {
        updateId: ctx?.update?.update_id ?? null,
        chatId: String(ctx?.chat?.id || ''),
        userId: String(ctx?.from?.id || ''),
        error: String(error?.message || error).slice(0, 300)
      });
    });

    this.botInfo = await this.bot.telegram.getMe();
    this.initialized = true;
    this.logger?.info?.('Support bot initialized', {
      botId: String(this.botInfo?.id || ''),
      adminCount: this.adminIds.length
    });
    return this;
  }

  async launch(onLaunch) {
    if (!this.initialized) await this.init();

    if (this.launched) {
      onLaunch?.();
      return this;
    }

    let announced = false;

    const markLaunched = () => {
      if (announced) return;
      announced = true;
      this.launched = true;

      this.logger?.info?.('Support bot launched', {
        botId: String(this.botInfo?.id || '')
      });

      onLaunch?.();
    };

    await this.bot.launch(markLaunched);
    markLaunched();
    return this;
  }

  async stop(reason = 'shutdown') {
    if (!this.initialized) return;
    if (this.launched) await this.bot.stop(reason);
    this.launched = false;
    this.rateLimitHits.clear();
    this.logger?.info?.('Support bot stopped', { reason: safeDisplayText(reason, 80) });
  }

  isAdmin(userId) {
    return this.adminIdSet.has(String(userId || ''));
  }

  checkUserRateLimit(userId) {
    const key = String(userId || '');
    const timestamp = Number(this.now()) || Date.now();
    const active = (this.rateLimitHits.get(key) || [])
      .filter((hit) => timestamp - hit < this.rateLimitWindowMs);
    if (active.length >= this.rateLimitMaxMessages) {
      this.rateLimitHits.set(key, active);
      return false;
    }
    active.push(timestamp);
    this.rateLimitHits.set(key, active);

    if (this.rateLimitHits.size > 5000) {
      for (const [candidate, hits] of this.rateLimitHits) {
        if (!hits.some((hit) => timestamp - hit < this.rateLimitWindowMs)) {
          this.rateLimitHits.delete(candidate);
        }
        if (this.rateLimitHits.size <= 4000) break;
      }
    }
    return true;
  }

  async handleStart(ctx) {
    const english = isEnglishUser(ctx.from);
    await ctx.reply(english
      ? 'Hello, this is customer support. Describe the problem directly, such as the bot not replying, incorrect credit balance, a payment or package issue, file parsing failure, or an image/voice problem. We will handle it as soon as possible.'
      : '你好，这里是客服支持。请直接描述你遇到的问题，例如：Bot 无法回复、额度显示错误、充值/套餐问题、文件解析失败、语音或图片功能异常。我们会尽快处理。');
  }

  isOwnTicketMessage(message = {}) {
    const authorId = String(message.from?.id || '');
    const botId = String(this.botInfo?.id || '');
    return Boolean(botId && authorId === botId && parseSupportTicketUserId(message));
  }

  async handleMessage(ctx) {
    const message = ctx.message || {};
    const userId = String(ctx.from?.id || '');
    if (!userId || ctx.from?.is_bot) return;
    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(String(message.text || ''))) return;

    if (this.isAdmin(userId)) {
      await this.handleAdminReply(ctx);
      return;
    }

    await this.handleUserRequest(ctx);
  }

  async handleUserRequest(ctx) {
    const userId = String(ctx.from?.id || '');
    const english = isEnglishUser(ctx.from);
    const type = supportMessageType(ctx.message);

    if (type === 'unsupported') {
      await ctx.reply(english
        ? 'Please send text, a photo, a voice message, or a document.'
        : '请发送文字、图片、语音或文件。');
      return;
    }

    if (!this.checkUserRateLimit(userId)) {
      await ctx.reply(english
        ? 'You are sending messages too quickly. Please wait and try again.'
        : '消息发送过于频繁，请稍后再试。');
      this.logger?.warn?.('Support request rate limited', { userId, type });
      return;
    }

    const ticketText = buildSupportTicketText({
      user: ctx.from,
      message: ctx.message,
      now: new Date(Number(this.now()) || Date.now())
    });
    const deliveries = await Promise.allSettled(
      this.adminIds.map((adminId) => this.sendTicketToAdmin(ctx, adminId, type, ticketText))
    );
    const delivered = deliveries.filter((result) => result.status === 'fulfilled').length;

    this.logger?.info?.('Support request relayed', {
      userId,
      type,
      deliveredAdminCount: delivered,
      failedAdminCount: deliveries.length - delivered
    });

    if (delivered === 0) {
      await ctx.reply(english
        ? 'Support is temporarily unavailable. Please try again later.'
        : '客服暂时无法接收消息，请稍后再试。');
      return;
    }

    // 工单发送成功后保持静默，等待人工客服回复。
  }

  async sendTicketToAdmin(ctx, adminId, type, ticketText) {
    if (type === 'text') {
      return ctx.telegram.sendMessage(
        adminId,
        truncateTelegramText(ticketText, TELEGRAM_TEXT_LIMIT),
        { link_preview_options: { is_disabled: true } }
      );
    }

    return ctx.telegram.copyMessage(
      adminId,
      ctx.chat.id,
      ctx.message.message_id,
      { caption: truncateTelegramText(ticketText, TELEGRAM_CAPTION_LIMIT) }
    );
  }

  async handleAdminReply(ctx) {
    const repliedMessage = ctx.message?.reply_to_message;
    const targetUserId = parseSupportTicketUserId(repliedMessage);
    if (!targetUserId || !this.isOwnTicketMessage(repliedMessage)) {
      await ctx.reply('请直接回复客服 Bot 发出的工单消息，系统才能安全地把内容转给用户。');
      return;
    }

    try {
      await ctx.telegram.copyMessage(
        targetUserId,
        ctx.chat.id,
        ctx.message.message_id
      );
      await ctx.reply('✅ 已发送给用户。');
      this.logger?.info?.('Support reply delivered', {
        targetUserId,
        replyType: supportMessageType(ctx.message)
      });
    } catch (error) {
      this.logger?.warn?.('Support reply delivery failed', {
        targetUserId,
        replyType: supportMessageType(ctx.message),
        error: String(error?.message || error).slice(0, 300)
      });
      await ctx.reply('回复发送失败。用户可能已屏蔽客服 Bot，请稍后重试。');
    }
  }
}

export function createSupportBot(options = {}) {
  const config = options.config || {};
  if (config.supportEnabled !== true || !String(config.supportBotToken || '').trim()) return null;
  return new SupportTelegramBot(options);
}

export const supportBotInternals = {
  SUPPORT_TICKET_PATTERN,
  normalizeAdminIds,
  safeDisplayText,
  supportMessageType,
  parseSupportTicketUserId,
  buildSupportTicketText,
  truncateTelegramText,
  createConfigurationError
};
