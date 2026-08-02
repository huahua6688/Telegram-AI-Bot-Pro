import crypto from 'node:crypto';
import { Telegraf } from 'telegraf';

const SUPPORT_TICKET_PATTERN = /^\[support-ticket:user=(\d{1,20})\]/m;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_MESSAGES = 5;
const TELEGRAM_TEXT_LIMIT = 4096;
const PRIVACY_NOTICE_ZH = '为保护隐私，请勿发送密码、Telegram 登录验证码、二步验证密码、API Key、钱包助记词或私钥、银行卡完整资料或证件原图。你的问题可能由授权客服人员查看和处理。';
const PRIVACY_NOTICE_EN = 'For your privacy, do not send passwords, Telegram login codes, two-step verification passwords, API keys, wallet seed phrases or private keys, full bank-card details, or identity-document images. Your request may be viewed and handled by authorized support staff.';

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

function makeTicketId() {
  return crypto.randomBytes(5).toString('hex');
}

function messageReference(ctx, type, timestamp) {
  const chatId = String(ctx.chat?.id || '');
  const messageId = Number(ctx.message?.message_id || 0);
  return {
    key: `${chatId}:${messageId}`,
    chatId,
    messageId,
    type,
    receivedAt: new Date(timestamp).toISOString()
  };
}

function adminMessageKey(chatId, messageId) {
  return `${String(chatId || '')}:${Number(messageId || 0)}`;
}

function inlineKeyboard(rows) {
  return { inline_keyboard: rows };
}

export class SupportTelegramBot {
  constructor({
    config = {},
    logger = null,
    telegrafFactory = (token) => new Telegraf(token),
    now = () => Date.now(),
    ticketIdFactory = makeTicketId
  } = {}) {
    this.config = config;
    this.logger = logger;
    this.now = now;
    this.ticketIdFactory = ticketIdFactory;
    this.adminIds = normalizeAdminIds(config.supportAdminIds);
    this.adminIdSet = new Set(this.adminIds);

    const rawSuperAdminIds =
      config.supportSuperAdminIds ??
      process.env.SUPPORT_SUPER_ADMIN_IDS ??
      [];

    const superAdminValues = rawSuperAdminIds instanceof Set
      ? Array.from(rawSuperAdminIds)
      : Array.isArray(rawSuperAdminIds)
        ? rawSuperAdminIds
        : String(rawSuperAdminIds).split(',');

    this.superAdminIds = Array.from(new Set(
      superAdminValues
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ));

    this.superAdminIdSet = new Set(this.superAdminIds);

    // ???????????????????????????
    for (const adminId of this.superAdminIds) {
      if (!this.adminIdSet.has(adminId)) {
        this.adminIds.push(adminId);
        this.adminIdSet.add(adminId);
      }
    }
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
    this.tickets = new Map();
    this.activeTicketByUser = new Map();
    this.adminMessageIndex = new Map();
    this.ticketAutoCloseMinutes = asPositiveInteger(
      config.supportTicketAutoCloseMinutes ??
        process.env.SUPPORT_TICKET_AUTO_CLOSE_MINUTES,
      1440,
      10080
    );
    this.ticketAutoCloseTimers = new Map();
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
    this.bot.action(/^s:c:([a-f0-9]+)$/i, (ctx) => this.handleClaim(ctx, ctx.match?.[1]));
    this.bot.action(/^s:m:([a-f0-9]+)$/i, (ctx) => this.handleTransferMenu(ctx, ctx.match?.[1]));
    this.bot.action(/^s:t:([a-f0-9]+):(\d+)$/i, (ctx) => this.handleTransfer(ctx, ctx.match?.[1], Number(ctx.match?.[2])));
    this.bot.action(/^s:r:([a-f0-9]+)$/i, (ctx) => this.handleReturnToQueue(ctx, ctx.match?.[1]));
    this.bot.action(/^s:z:([a-f0-9]+)$/i, (ctx) => this.handleClose(ctx, ctx.match?.[1]));
    this.bot.action(/^s:n:([a-f0-9]+)$/i, (ctx) => this.handleCancelMenu(ctx, ctx.match?.[1]));
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
      this.logger?.info?.('Support bot launched', { botId: String(this.botInfo?.id || '') });
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
    for (const timer of this.ticketAutoCloseTimers.values()) {
      clearTimeout(timer);
    }
    this.ticketAutoCloseTimers.clear();
    this.tickets.clear();
    this.activeTicketByUser.clear();
    this.adminMessageIndex.clear();
    this.logger?.info?.('Support bot stopped', { reason: safeDisplayText(reason, 80) });
  }

  clearTicketAutoClose(ticketId) {
    const normalizedTicketId = String(ticketId || '');
    const timer = this.ticketAutoCloseTimers.get(
      normalizedTicketId
    );

    if (timer) {
      clearTimeout(timer);
      this.ticketAutoCloseTimers.delete(
        normalizedTicketId
      );
    }

    const ticket = this.tickets.get(
      normalizedTicketId
    );

    if (ticket) {
      ticket.autoCloseAt = null;
    }
  }

  scheduleTicketAutoClose(telegram, ticket) {
    if (!ticket || ticket.status !== 'assigned') {
      return;
    }

    this.clearTicketAutoClose(ticket.ticketId);

    const timestamp =
      Number(this.now()) || Date.now();

    const delay =
      this.ticketAutoCloseMinutes * 60_000;

    ticket.autoCloseAt =
      new Date(timestamp + delay).toISOString();

    const timer = setTimeout(() => {
      void this.handleTicketAutoClose(
        telegram,
        ticket.ticketId
      );
    }, delay);

    timer.unref?.();

    this.ticketAutoCloseTimers.set(
      ticket.ticketId,
      timer
    );
  }

  async handleTicketAutoClose(telegram, ticketId) {
    const normalizedTicketId = String(
      ticketId || ''
    );

    const ticket = this.tickets.get(
      normalizedTicketId
    );

    if (
      !ticket ||
      ticket.status !== 'assigned' ||
      !ticket.autoCloseAt
    ) {
      return false;
    }

    const timestamp =
      Number(this.now()) || Date.now();

    const deadline =
      Date.parse(ticket.autoCloseAt);

    if (
      !Number.isFinite(deadline) ||
      timestamp < deadline
    ) {
      return false;
    }

    const timer = this.ticketAutoCloseTimers.get(
      normalizedTicketId
    );

    if (timer) {
      clearTimeout(timer);
    }

    this.ticketAutoCloseTimers.delete(
      normalizedTicketId
    );

    ticket.status = 'closed';
    ticket.autoCloseAt = null;
    ticket.updatedAt =
      new Date(timestamp).toISOString();

    this.activeTicketByUser.delete(
      ticket.userId
    );

    await this.updateAllSummaries(
      telegram,
      ticket
    );

    this.logger?.info?.(
      'Support ticket auto closed',
      {
        ticketId: ticket.ticketId,
        userId: ticket.userId,
        assignedAdminId:
          ticket.assignedAdminId,
        replyCount: ticket.replyCount
      }
    );

    return true;
  }

  isAdmin(userId) {
    return this.adminIdSet.has(String(userId || ''));
  }

  isSuperAdmin(userId) {
    return this.superAdminIdSet.has(String(userId || ''));
  }

  adminLabel(adminId) {
    const index = this.adminIds.indexOf(String(adminId || ''));
    return index >= 0 ? `客服 ${index + 1}` : '客服';
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
    const english = String(ctx.from?.language_code || '')
      .toLowerCase()
      .startsWith('en');

    await ctx.reply(
      english
        ? 'Hello, how can we help you?'
        : '你好，请问有什么可以帮你的？'
    );
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

  createTicket(userId, ref, timestamp, userProfile = null) {
    let ticketId = String(this.ticketIdFactory() || '').toLowerCase().replace(/[^a-f0-9]/g, '').slice(0, 20);
    while (!ticketId || this.tickets.has(ticketId)) {
      ticketId = makeTicketId();
    }
    const ticket = {
      ticketId,
      userId: String(userId),
      userProfile: userProfile || null,
      status: 'open',
      assignedAdminId: null,
      createdAt: new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString(),
      lastReplyAt: null,
      replyCount: 0,
      messageRefs: [ref],
      summaryDeliveries: new Map(),
      transferHistory: [],
      deliveredMessageKeysByAdmin: new Map()
    };
    this.tickets.set(ticketId, ticket);
    this.activeTicketByUser.set(String(userId), ticketId);
    return ticket;
  }

  getActiveTicket(userId) {
    const ticketId = this.activeTicketByUser.get(String(userId || ''));
    if (!ticketId) return null;
    const ticket = this.tickets.get(ticketId) || null;
    if (!ticket || ticket.status === 'closed') {
      this.activeTicketByUser.delete(String(userId || ''));
      return null;
    }
    return ticket;
  }

  summaryText(ticket, adminId) {
    const latest = ticket.messageRefs.at(-1);
    const lines = [
      `客服工单 #${ticket.ticketId}`,
      `状态：${ticket.status === 'open' ? '🟡 等待接单' : ticket.status === 'assigned' ? '🔵 处理中' : '✅ 已关闭'}`,
      `消息数量：${ticket.messageRefs.length}`,
      `最新类型：${latest?.type || 'unknown'}`,
      `创建时间：${ticket.createdAt}`,
      `回复次数：${ticket.replyCount}`
    ];
    if (ticket.status === 'assigned') lines.push(`当前负责：${this.adminLabel(ticket.assignedAdminId)}`);
    if (ticket.lastReplyAt) lines.push(`最后回复：${ticket.lastReplyAt}`);
    lines.push('', '为保护用户隐私，完整内容仅向当前负责客服显示。');
    if (this.isSuperAdmin(adminId) && ticket.userProfile) {
      const profile = ticket.userProfile;
      const displayName = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .join(' ');

      lines.push(
        '',
        '\u4e00\u7ea7\u7ba1\u7406\u5458\u53ef\u89c1\u7528\u6237\u4fe1\u606f\uff1a',
        `\u7528\u6237 ID\uff1a${profile.userId || ticket.userId}`,
        `\u7528\u6237\u540d\uff1a${profile.username ? `@${profile.username}` : '\u672a\u8bbe\u7f6e'}`,
        `\u59d3\u540d\uff1a${displayName || '\u672a\u8bbe\u7f6e'}`,
        `\u8bed\u8a00\uff1a${profile.languageCode || '\u672a\u63d0\u4f9b'}`
      );
    }

    return truncateTelegramText(lines.join('\n'));
  }

  summaryReplyMarkup(ticket, adminId) {
    if (ticket.status === 'open') {
      return inlineKeyboard([[{ text: '接单', callback_data: `s:c:${ticket.ticketId}` }]]);
    }
    if (ticket.status === 'assigned' && ticket.assignedAdminId === String(adminId)) {
      return inlineKeyboard([
        [
          { text: '转交', callback_data: `s:m:${ticket.ticketId}` },
          { text: '退回待接单', callback_data: `s:r:${ticket.ticketId}` }
        ],
        [{ text: '关闭工单', callback_data: `s:z:${ticket.ticketId}` }]
      ]);
    }
    return inlineKeyboard([]);
  }

  async sendSummaryToAdmin(telegram, ticket, adminId) {
    const result = await telegram.sendMessage(
      adminId,
      this.summaryText(ticket, adminId),
      {
        protect_content: true,
        link_preview_options: { is_disabled: true },
        reply_markup: this.summaryReplyMarkup(ticket, adminId)
      }
    );
    const messageId = Number(result?.message_id || 0);
    if (messageId) {
      ticket.summaryDeliveries.set(String(adminId), messageId);
      this.adminMessageIndex.set(adminMessageKey(adminId, messageId), ticket.ticketId);
    }
    return result;
  }

  async updateAllSummaries(telegram, ticket) {
    const operations = Array.from(ticket.summaryDeliveries.entries()).map(async ([adminId, messageId]) => {
      try {
        await telegram.editMessageText(
          adminId,
          messageId,
          undefined,
          this.summaryText(ticket, adminId),
          {
            link_preview_options: { is_disabled: true },
            reply_markup: this.summaryReplyMarkup(ticket, adminId)
          }
        );
      } catch (error) {
        this.logger?.warn?.('Support summary update failed', {
          ticketId: ticket.ticketId,
          adminId,
          error: String(error?.message || error).slice(0, 200)
        });
      }
    });
    await Promise.allSettled(operations);
  }

  deliveredSet(ticket, adminId) {
    const key = String(adminId);
    let delivered = ticket.deliveredMessageKeysByAdmin.get(key);
    if (!delivered) {
      delivered = new Set();
      ticket.deliveredMessageKeysByAdmin.set(key, delivered);
    }
    return delivered;
  }

  deliveryLabelText(ticket, adminId, ref) {
    const messageIndex = ticket.messageRefs.findIndex(
      (item) => item.key === ref.key
    );

    const messageNumber =
      messageIndex >= 0
        ? messageIndex + 1
        : ticket.messageRefs.length;

    const lines = [
      '\ud83d\udce8 \u65b0\u7684\u7528\u6237\u6d88\u606f',
      `\u5de5\u5355\uff1a#${ticket.ticketId}`,
      `\u6d88\u606f\uff1a${messageNumber}/${ticket.messageRefs.length}`
    ];

    if (
      this.isSuperAdmin(adminId) &&
      ticket.userProfile
    ) {
      const profile = ticket.userProfile;

      const displayName = [
        profile.firstName,
        profile.lastName
      ].filter(Boolean).join(' ');

      lines.push(
        `\u7528\u6237 ID\uff1a${profile.userId || ticket.userId}`,
        `\u7528\u6237\u540d\uff1a${profile.username ? `@${profile.username}` : '\u672a\u8bbe\u7f6e'}`,
        `\u59d3\u540d\uff1a${displayName || '\u672a\u8bbe\u7f6e'}`,
        `\u8bed\u8a00\uff1a${profile.languageCode || '\u672a\u63d0\u4f9b'}`
      );
    } else {
      const anonymousId = String(
        ticket.ticketId || ''
      ).slice(0, 6).toUpperCase();

      lines.push(
        `\u533f\u540d\u8bbf\u5ba2\uff1a${anonymousId}`
      );
    }

    lines.push(
      '',
      '\u8bf7\u76f4\u63a5\u56de\u590d\u4e0b\u65b9\u7528\u6237\u6d88\u606f\u3002'
    );

    return lines.join('\n');
  }

  async deliverReferenceToAdmin(
    telegram,
    ticket,
    adminId,
    ref
  ) {
    const delivered = this.deliveredSet(ticket, adminId);

    if (delivered.has(ref.key)) {
      return false;
    }

    const labelResult = await telegram.sendMessage(
      adminId,
      this.deliveryLabelText(
        ticket,
        adminId,
        ref
      ),
      {
        protect_content: true,
        link_preview_options: {
          is_disabled: true
        }
      }
    );

    const labelMessageId =
      Number(labelResult?.message_id || 0);

    if (labelMessageId) {
      this.adminMessageIndex.set(
        adminMessageKey(
          adminId,
          labelMessageId
        ),
        ticket.ticketId
      );
    }

    const copyOptions = {
      protect_content: true
    };

    if (labelMessageId) {
      copyOptions.reply_parameters = {
        message_id: labelMessageId,
        allow_sending_without_reply: true
      };
    }

    const result = await telegram.copyMessage(
      adminId,
      ref.chatId,
      ref.messageId,
      copyOptions
    );

    delivered.add(ref.key);

    const copiedMessageId =
      Number(result?.message_id || 0);

    if (copiedMessageId) {
      this.adminMessageIndex.set(
        adminMessageKey(
          adminId,
          copiedMessageId
        ),
        ticket.ticketId
      );
    }

    return true;
  }  async deliverUnreadHistory(telegram, ticket, adminId) {
    for (const ref of ticket.messageRefs) {
      try {
        await this.deliverReferenceToAdmin(telegram, ticket, adminId, ref);
      } catch (error) {
        this.logger?.warn?.('Support private message delivery failed', {
          ticketId: ticket.ticketId,
          adminId: String(adminId),
          messageType: ref.type,
          error: String(error?.message || error).slice(0, 200)
        });
      }
    }
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

    const timestamp = Number(this.now()) || Date.now();
    const ref = messageReference(ctx, type, timestamp);
    let ticket = this.getActiveTicket(userId);

    if (ticket) {
      this.clearTicketAutoClose(ticket.ticketId); // user replied
    }
    const isNew = !ticket;
    if (isNew) {
      ticket = this.createTicket(
        userId,
        ref,
        timestamp,
        {
          userId,
          username: safeDisplayText(ctx.from?.username || '', 64),
          firstName: safeDisplayText(ctx.from?.first_name || '', 64),
          lastName: safeDisplayText(ctx.from?.last_name || '', 64),
          languageCode: safeDisplayText(ctx.from?.language_code || '', 32)
        }
      );
    }
    else {
      ticket.messageRefs.push(ref);
      ticket.updatedAt = new Date(timestamp).toISOString();
    }

    if (isNew) {
      const deliveries = await Promise.allSettled(
        this.adminIds.map((adminId) => this.sendSummaryToAdmin(ctx.telegram, ticket, adminId))
      );
      const delivered = deliveries.filter((result) => result.status === 'fulfilled').length;
      this.logger?.info?.('Support request relayed', {
        ticketId: ticket.ticketId,
        userId,
        type,
        deliveredAdminCount: delivered,
        failedAdminCount: deliveries.length - delivered
      });
      if (delivered === 0) {
        this.tickets.delete(ticket.ticketId);
        this.activeTicketByUser.delete(userId);
        await ctx.reply(english
          ? 'Support is temporarily unavailable. Please try again later.'
          : '客服暂时无法接收消息，请稍后再试。');
      }
      return;
    }

    const currentOwnerId = String(
      ticket.assignedAdminId || ''
    );

    if (
      ticket.status === 'assigned' &&
      (
        !currentOwnerId ||
        !this.adminIdSet.has(currentOwnerId)
      )
    ) {
      ticket.status = 'open';
      ticket.assignedAdminId = null;
      ticket.updatedAt =
        new Date(timestamp).toISOString();

      await this.updateAllSummaries(
        ctx.telegram,
        ticket
      );

      const deliveries = await Promise.allSettled(
        this.adminIds.map((adminId) =>
          this.sendSummaryToAdmin(
            ctx.telegram,
            ticket,
            adminId
          )
        )
      );

      this.logger?.warn?.(
        'Support ticket owner removed from configuration',
        {
          ticketId: ticket.ticketId,
          previousAdminId:
            currentOwnerId || null,
          notifiedAdminCount:
            deliveries.filter(
              (result) =>
                result.status === 'fulfilled'
            ).length
        }
      );
    }

    if (ticket.status === 'assigned' && ticket.assignedAdminId) {
      try {
        await this.deliverReferenceToAdmin(ctx.telegram, ticket, ticket.assignedAdminId, ref);
      } catch (error) {
        this.logger?.warn?.('Support follow-up delivery failed', {
          ticketId: ticket.ticketId,
          userId,
          type,
          error: String(error?.message || error).slice(0, 200)
        });
      }
    }
    await this.updateAllSummaries(ctx.telegram, ticket);
    this.logger?.info?.('Support request appended', { ticketId: ticket.ticketId, userId, type, status: ticket.status });
  }

  getTicketForAction(ctx, ticketId) {
    const adminId = String(ctx.from?.id || '');
    if (!this.isAdmin(adminId)) return { adminId, ticket: null, error: '无权操作客服工单。' };
    const ticket = this.tickets.get(String(ticketId || ''));
    if (!ticket) return { adminId, ticket: null, error: '该工单状态已失效，可能是服务重新部署导致，请让用户重新发送问题。' };
    return { adminId, ticket, error: '' };
  }

  async answerAction(ctx, text, alert = false) {
    try {
      await ctx.answerCbQuery(text, { show_alert: alert });
    } catch {
      // Callback may already be answered; the state change remains valid.
    }
  }

  async handleClaim(ctx, ticketId) {
    const { adminId, ticket, error } = this.getTicketForAction(ctx, ticketId);
    if (error) return this.answerAction(ctx, error, true);
    if (ticket.status === 'closed') return this.answerAction(ctx, '该工单已关闭。', true);
    if (ticket.status === 'assigned') {
      const message = ticket.assignedAdminId === adminId ? '你已经是该工单的负责客服。' : '该工单已由其他客服接单。';
      return this.answerAction(ctx, message, true);
    }

    // Set ownership synchronously before the first await so only one callback wins.
    ticket.status = 'assigned';
    ticket.assignedAdminId = adminId;
    ticket.updatedAt = new Date(Number(this.now()) || Date.now()).toISOString();

    await this.answerAction(ctx, '接单成功。');
    await this.updateAllSummaries(ctx.telegram, ticket);
    await this.deliverUnreadHistory(ctx.telegram, ticket, adminId);
    this.logger?.info?.('Support ticket claimed', { ticketId: ticket.ticketId, adminId });
  }

  async handleTransferMenu(ctx, ticketId) {
    const { adminId, ticket, error } = this.getTicketForAction(ctx, ticketId);
    if (error) return this.answerAction(ctx, error, true);
    if (ticket.status !== 'assigned' || ticket.assignedAdminId !== adminId) {
      return this.answerAction(ctx, '只有当前负责客服可以转交工单。', true);
    }
    const rows = this.adminIds
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate !== adminId)
      .map(({ candidate, index }) => [{ text: `转交给${this.adminLabel(candidate)}`, callback_data: `s:t:${ticket.ticketId}:${index}` }]);
    rows.push([{ text: '取消', callback_data: `s:n:${ticket.ticketId}` }]);
    await ctx.editMessageReplyMarkup(inlineKeyboard(rows));
    await this.answerAction(ctx, '请选择新的负责客服。');
  }

  async handleCancelMenu(ctx, ticketId) {
    const { adminId, ticket, error } = this.getTicketForAction(ctx, ticketId);
    if (error) return this.answerAction(ctx, error, true);
    await ctx.editMessageReplyMarkup(this.summaryReplyMarkup(ticket, adminId));
    await this.answerAction(ctx, '已取消。');
  }

  async handleTransfer(ctx, ticketId, targetIndex) {
    const { adminId, ticket, error } = this.getTicketForAction(ctx, ticketId);
    if (error) return this.answerAction(ctx, error, true);
    const targetAdminId = this.adminIds[targetIndex];
    if (!targetAdminId || targetAdminId === adminId) return this.answerAction(ctx, '转交目标无效。', true);
    if (ticket.status !== 'assigned' || ticket.assignedAdminId !== adminId) {
      return this.answerAction(ctx, '工单负责人已经变化，无法继续转交。', true);
    }

    const timestamp = Number(this.now()) || Date.now();
    ticket.assignedAdminId = targetAdminId;
    ticket.updatedAt = new Date(timestamp).toISOString();
    ticket.transferHistory.push({ fromAdminId: adminId, toAdminId: targetAdminId, transferredAt: ticket.updatedAt });

    await this.answerAction(ctx, `已转交给${this.adminLabel(targetAdminId)}。`);
    await this.updateAllSummaries(ctx.telegram, ticket);
    await this.deliverUnreadHistory(ctx.telegram, ticket, targetAdminId);
    this.logger?.info?.('Support ticket transferred', { ticketId: ticket.ticketId, fromAdminId: adminId, toAdminId: targetAdminId });
  }

  async handleReturnToQueue(ctx, ticketId) {
    const { adminId, ticket, error } = this.getTicketForAction(ctx, ticketId);
    if (error) return this.answerAction(ctx, error, true);
    if (ticket.status !== 'assigned' || ticket.assignedAdminId !== adminId) {
      return this.answerAction(ctx, '只有当前负责客服可以退回工单。', true);
    }
    this.clearTicketAutoClose(
      ticket.ticketId
    );
    ticket.status = 'open';
    ticket.assignedAdminId = null;
    ticket.updatedAt = new Date(Number(this.now()) || Date.now()).toISOString();
    await this.answerAction(ctx, '工单已退回待接单。');
    await this.updateAllSummaries(ctx.telegram, ticket);
    this.logger?.info?.('Support ticket returned to queue', { ticketId: ticket.ticketId, adminId });
  }

  async handleClose(ctx, ticketId) {
    const { adminId, ticket, error } = this.getTicketForAction(ctx, ticketId);
    if (error) return this.answerAction(ctx, error, true);
    if (ticket.status !== 'assigned' || ticket.assignedAdminId !== adminId) {
      return this.answerAction(ctx, '只有当前负责客服可以关闭工单。', true);
    }
    this.clearTicketAutoClose(
      ticket.ticketId
    );
    ticket.status = 'closed';
    ticket.updatedAt = new Date(Number(this.now()) || Date.now()).toISOString();
    this.activeTicketByUser.delete(ticket.userId);
    await this.answerAction(ctx, '工单已关闭。');
    await this.updateAllSummaries(ctx.telegram, ticket);
    this.logger?.info?.('Support ticket closed', { ticketId: ticket.ticketId, adminId, replyCount: ticket.replyCount });
  }

  async handleAdminReply(ctx) {
    const adminId = String(ctx.from?.id || '');
    const repliedMessageId = Number(ctx.message?.reply_to_message?.message_id || 0);
    if (!repliedMessageId) {
      await ctx.reply('请直接回复客服 Bot 发出的工单摘要或用户消息。');
      return;
    }
    const ticketId = this.adminMessageIndex.get(adminMessageKey(ctx.chat?.id, repliedMessageId));
    const ticket = ticketId ? this.tickets.get(ticketId) : null;
    if (!ticket) {
      await ctx.reply('该工单状态已失效，可能是服务重新部署导致，请让用户重新发送问题。');
      return;
    }
    if (ticket.status === 'closed') {
      await ctx.reply('该工单已关闭，不能继续回复。');
      return;
    }
    if (ticket.status !== 'assigned' || !ticket.assignedAdminId) {
      await ctx.reply('该工单尚未接单，请先点击“接单”。');
      return;
    }
    if (ticket.assignedAdminId !== adminId) {
      await ctx.reply('该工单当前由其他客服处理，你的消息没有发送给用户。');
      return;
    }

    try {
      await ctx.telegram.copyMessage(
        ticket.userId,
        ctx.chat.id,
        ctx.message.message_id,
        { protect_content: true }
      );
      const timestamp = Number(this.now()) || Date.now();
      ticket.replyCount += 1;
      ticket.lastReplyAt = new Date(timestamp).toISOString();
      ticket.updatedAt = ticket.lastReplyAt;

      this.scheduleTicketAutoClose(
        ctx.telegram,
        ticket
      );
      await ctx.reply('✅ 已发送给用户。');
      await this.updateAllSummaries(ctx.telegram, ticket);
      this.logger?.info?.('Support reply delivered', {
        ticketId: ticket.ticketId,
        targetUserId: ticket.userId,
        adminId,
        replyType: supportMessageType(ctx.message),
        replyCount: ticket.replyCount
      });
    } catch (error) {
      this.logger?.warn?.('Support reply delivery failed', {
        ticketId: ticket.ticketId,
        targetUserId: ticket.userId,
        adminId,
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
  createConfigurationError,
  makeTicketId,
  messageReference,
  adminMessageKey
};
