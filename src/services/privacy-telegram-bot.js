import { Markup } from 'telegraf';
import { personaPresets } from '../config.js';
import { truncateText } from '../utils/text.js';
import { TelegramAIBot } from './telegram-bot.js';

const DEFAULT_PRIVACY_TTL_MINUTES = 30;
const DEFAULT_PRIVACY_CONTEXT_MESSAGES = 6;
const DEFAULT_PRIVACY_CONTEXT_CHARS = 12000;
const DEFAULT_PRIVACY_SESSION_MESSAGE_LIMIT = 50;

function readPositiveInteger(value, fallback, { min = 1, max = 10000 } = {}) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(max, parsed);
}

function isEnglishLocale(locale = '') {
  return String(locale || '').toLowerCase().startsWith('en');
}

function localText(locale, zh, en) {
  return isEnglishLocale(locale) ? en : zh;
}

function contentLength(content) {
  if (typeof content === 'string') return content.length;
  try {
    return JSON.stringify(content).length;
  } catch {
    return 0;
  }
}

function trimEphemeralHistory(messages = [], maxMessages = DEFAULT_PRIVACY_CONTEXT_MESSAGES, maxChars = DEFAULT_PRIVACY_CONTEXT_CHARS) {
  const source = Array.isArray(messages) ? messages : [];
  const kept = [];
  let usedChars = 0;

  for (let index = source.length - 1; index >= 0; index -= 1) {
    const item = source[index];
    const size = contentLength(item?.content);
    if (kept.length >= maxMessages) break;
    if (kept.length > 0 && usedChars + size > maxChars) break;
    kept.unshift(item);
    usedChars += size;
  }

  return kept;
}

function createPrivacySystemPrompt(config, user, locale) {
  const persona = user?.customSystemPrompt || personaPresets[user?.persona] || config.systemPrompt || 'You are a helpful AI assistant.';
  const languageRule = isEnglishLocale(locale)
    ? 'Answer in English unless the user explicitly requests another language.'
    : '除非用户明确要求其他语言，否则使用简体中文回答。';

  return [
    persona,
    '',
    languageRule,
    '',
    'Privacy-session rules:',
    '- This is a temporary privacy session.',
    '- Do not claim access to saved chat history, long-term memory, files, web search, or external tools.',
    '- Use only the messages included in this request.',
    '- Never ask the user to reveal passwords, verification codes, wallet seed phrases, private keys, or API keys.',
    '- Keep the answer direct and useful.'
  ].join('\n');
}

function safeErrorMeta(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    code: String(error?.code || error?.cause?.code || '').slice(0, 80),
    status: Number(error?.status || error?.cause?.status || 0) || undefined
  };
}

export class PrivacyTelegramAIBot extends TelegramAIBot {
  constructor(options) {
    super(options);

    this.privacyConfig = {
      ttlMs: readPositiveInteger(process.env.PRIVACY_SESSION_TTL_MINUTES, DEFAULT_PRIVACY_TTL_MINUTES, { max: 1440 }) * 60 * 1000,
      maxContextMessages: readPositiveInteger(process.env.PRIVACY_CONTEXT_MESSAGES, DEFAULT_PRIVACY_CONTEXT_MESSAGES, { max: 40 }),
      maxContextChars: readPositiveInteger(process.env.PRIVACY_CONTEXT_CHARS, DEFAULT_PRIVACY_CONTEXT_CHARS, { max: 100000 }),
      maxSessionMessages: readPositiveInteger(process.env.PRIVACY_SESSION_MAX_MESSAGES, DEFAULT_PRIVACY_SESSION_MESSAGE_LIMIT, { max: 1000 })
    };

    this.bot.action(/^privacy_pick:(.+)$/, (ctx) =>
      this.withCompactCallbackReply(ctx, () => this.handlePrivacyCallback(ctx))
    );

    this.privacySweepTimer = setInterval(() => this.sweepExpiredPrivacyModes(), 60 * 1000);
    this.privacySweepTimer.unref?.();
  }

  getPrivacyLabel(locale = 'zh') {
    return localText(locale, '🔒 隐私聊天', '🔒 Private chat');
  }

  createBottomKeyboard(locale = 'zh') {
    if (this.config?.miniAppEnabled !== false) {
      return {
        reply_markup: {
          keyboard: [[this.getPrivacyLabel(locale)]],
          resize_keyboard: true,
          is_persistent: true,
          input_field_placeholder: localText(locale, '直接输入需求，我会自动判断…', 'Ask naturally; I will route it automatically…')
        }
      };
    }

    const keyboard = super.createBottomKeyboard(locale);
    const rows = keyboard?.reply_markup?.keyboard;
    if (Array.isArray(rows) && !rows.flat().includes(this.getPrivacyLabel(locale))) {
      rows.unshift([this.getPrivacyLabel(locale)]);
    }
    return keyboard;
  }

  createSettingsKeyboard(locale = 'zh') {
    const keyboard = super.createSettingsKeyboard(locale);
    if (this.config?.miniAppEnabled !== false) return keyboard;
    const rows = keyboard?.reply_markup?.inline_keyboard;
    if (Array.isArray(rows)) {
      rows.splice(1, 0, [Markup.button.callback(this.getPrivacyLabel(locale), 'privacy_pick:menu')]);
    }
    return keyboard;
  }

  createPrivacyPanelKeyboard(locale = 'zh') {
    return Markup.inlineKeyboard([
      [Markup.button.callback(localText(locale, '🔒 单轮隐私（最强）', '🔒 Single-turn privacy'), 'privacy_pick:single')],
      [Markup.button.callback(localText(locale, '🕶 临时上下文（仅内存）', '🕶 Temporary in-memory context'), 'privacy_pick:temporary')],
      [Markup.button.callback(localText(locale, '📋 当前隐私状态', '📋 Privacy status'), 'privacy_pick:status')],
      [Markup.button.callback(localText(locale, '❌ 退出隐私聊天', '❌ Exit private chat'), 'privacy_pick:exit')],
      [Markup.button.callback(localText(locale, '⬅️ 返回聊天', '⬅️ Back to chat'), 'menu:close')]
    ]);
  }

  createPrivacyModeKeyboard(locale = 'zh', contextMode = 'single') {
    const rows = [];
    if (contextMode === 'temporary') {
      rows.push([Markup.button.callback(localText(locale, '🧹 清除临时上下文', '🧹 Clear temporary context'), 'privacy_pick:clear')]);
    }
    rows.push([Markup.button.callback(localText(locale, '🔁 切换隐私模式', '🔁 Switch privacy mode'), 'privacy_pick:menu')]);
    rows.push([Markup.button.callback(localText(locale, '❌ 退出隐私聊天', '❌ Exit private chat'), 'privacy_pick:exit')]);
    return Markup.inlineKeyboard(rows);
  }

  async handleBottomKeyboardAction(ctx) {
    const text = String(ctx.message?.text || '').trim();
    const normalized = text.replace(/[🔒🕶]/g, '').trim().toLowerCase();
    if (/^(隐私聊天|私密聊天|private chat|privacy)$/.test(normalized)) {
      await this.showPrivacyPanel(ctx);
      return true;
    }
    return super.handleBottomKeyboardAction(ctx);
  }

  async showPrivacyPanel(ctx) {
    const locale = this.getLocale(ctx);
    if (ctx.chat?.type !== 'private') {
      await ctx.reply(
        localText(locale, '隐私聊天只允许在与 Bot 的私聊中使用。', 'Private chat is available only in a direct chat with the bot.'),
        this.createBottomKeyboard(locale)
      );
      return;
    }

    const text = localText(
      locale,
      [
        '🔒 隐私聊天',
        '',
        '单轮隐私：每条消息独立处理，不读取历史，也不保留临时上下文。',
        '临时上下文：只在当前进程内存中保留少量消息，30 分钟无操作、退出模式或服务重启后清除。',
        '',
        '两种模式都不会把消息正文、回复正文或临时上下文写入数据库，也不会建立长期记忆、聊天记录、收藏或工具调用记录。',
        '',
        '注意：当前消息仍会通过 Telegram，并发送给你选择的 AI 模型供应商进行推理。隐私模式不是端到端加密。'
      ].join('\n'),
      [
        '🔒 Private chat',
        '',
        'Single-turn: each message is independent, with no history or temporary context.',
        'Temporary context: a small context stays only in process memory and is cleared after 30 minutes of inactivity, on exit, or on restart.',
        '',
        'Neither mode writes message text, replies, or temporary context to the database, and neither creates long-term memory, chat history, favorites, or tool-call records.',
        '',
        'Note: the current message still passes through Telegram and is sent to the selected AI provider for inference. This is not end-to-end encryption.'
      ].join('\n')
    );

    await ctx.reply(text, this.createPrivacyPanelKeyboard(locale));
  }

  async handlePrivacyCallback(ctx) {
    const locale = this.getLocale(ctx);
    const target = String(ctx.match?.[1] || '').trim();
    await ctx.answerCbQuery();

    if (target === 'menu') {
      await this.showPrivacyPanel(ctx);
      return;
    }

    if (target === 'single' || target === 'temporary') {
      if (ctx.chat?.type !== 'private') {
        await ctx.reply(localText(locale, '隐私聊天只能在私聊中开启。', 'Private chat can only be enabled in a direct chat.'));
        return;
      }
      this.startPrivacyMode(ctx, target);
      const settings = this.getEffectiveAISettings(ctx.from?.id);
      const modeName = target === 'single'
        ? localText(locale, '单轮隐私', 'single-turn privacy')
        : localText(locale, '临时上下文', 'temporary in-memory context');
      await ctx.reply(
        localText(
          locale,
          `已开启 ${modeName}。\n\n不会把消息或回复写入数据库；不会读取旧聊天记录；不会生成长期记忆；工具和自动备用 Provider 已关闭。\n当前 AI 平台：${this.getAIProviderLabel(settings.providerId)}\n\n发送“退出”或点击按钮即可结束。`,
          `${modeName} is enabled.\n\nMessages and replies are not written to the database; saved history and long-term memory are not used; tools and automatic provider fallback are disabled.\nCurrent AI provider: ${this.getAIProviderLabel(settings.providerId)}\n\nSend “exit” or tap the button to stop.`
        ),
        this.createPrivacyModeKeyboard(locale, target)
      );
      return;
    }

    if (target === 'clear') {
      const mode = this.getActiveMode(ctx);
      if (mode?.type === 'privacy') {
        this.wipePrivacyMessages(mode);
        mode.expiresAt = Date.now() + this.privacyConfig.ttlMs;
        mode.lastActivityAt = Date.now();
      }
      await ctx.reply(
        localText(locale, '临时上下文已清除，隐私模式仍保持开启。', 'Temporary context cleared. Private mode remains enabled.'),
        this.createPrivacyModeKeyboard(locale, mode?.contextMode || 'single')
      );
      return;
    }

    if (target === 'exit') {
      const existed = this.getActiveMode(ctx)?.type === 'privacy';
      this.clearActiveMode(ctx);
      await ctx.reply(
        existed
          ? localText(locale, '已退出隐私聊天，临时上下文已清除。', 'Private chat exited and temporary context cleared.')
          : localText(locale, '当前没有开启隐私聊天。', 'Private chat is not currently active.'),
        this.createBottomKeyboard(locale)
      );
      return;
    }

    if (target === 'status') {
      const mode = this.getActiveMode(ctx);
      if (mode?.type !== 'privacy') {
        await ctx.reply(localText(locale, '当前没有开启隐私聊天。', 'Private chat is not active.'), this.createPrivacyPanelKeyboard(locale));
        return;
      }
      const remainingMinutes = Math.max(0, Math.ceil((mode.expiresAt - Date.now()) / 60000));
      await ctx.reply(
        localText(
          locale,
          `隐私模式：${mode.contextMode === 'temporary' ? '临时上下文' : '单轮隐私'}\n本次已处理：${mode.messageCount || 0} 条\n内存上下文：${mode.messages?.length || 0} 条\n约 ${remainingMinutes} 分钟无操作后自动清除。`,
          `Privacy mode: ${mode.contextMode === 'temporary' ? 'temporary context' : 'single-turn'}\nProcessed: ${mode.messageCount || 0}\nIn-memory context: ${mode.messages?.length || 0} messages\nAutomatically clears after about ${remainingMinutes} minutes of inactivity.`
        ),
        this.createPrivacyModeKeyboard(locale, mode.contextMode)
      );
      return;
    }

    await this.showPrivacyPanel(ctx);
  }

  startPrivacyMode(ctx, contextMode = 'single') {
    this.clearActiveMode(ctx);
    const now = Date.now();
    this.setActiveMode(ctx, {
      type: 'privacy',
      contextMode: contextMode === 'temporary' ? 'temporary' : 'single',
      messages: [],
      messageCount: 0,
      startedAt: now,
      lastActivityAt: now,
      expiresAt: now + this.privacyConfig.ttlMs
    });
  }

  wipePrivacyMessages(mode) {
    if (!mode || !Array.isArray(mode.messages)) return;
    for (const item of mode.messages) {
      if (item && typeof item === 'object') item.content = '';
    }
    mode.messages.length = 0;
  }

  clearActiveMode(ctx) {
    const mode = this.getActiveMode(ctx);
    if (mode?.type === 'privacy') this.wipePrivacyMessages(mode);
    return super.clearActiveMode(ctx);
  }

  sweepExpiredPrivacyModes(now = Date.now()) {
    for (const [key, mode] of this.activeModes.entries()) {
      if (mode?.type !== 'privacy') continue;
      if (Number(mode.expiresAt || 0) > now) continue;
      this.wipePrivacyMessages(mode);
      this.activeModes.delete(key);
    }
  }

  async handleActiveMode(ctx, mode) {
    if (mode?.type !== 'privacy') {
      return super.handleActiveMode(ctx, mode);
    }

    const locale = this.getLocale(ctx);
    const input = String(ctx.message?.text || ctx.message?.caption || '').trim();

    if (/^(退出|退出模式|退出隐私|结束|关闭|stop|exit|cancel)$/i.test(input)) {
      this.clearActiveMode(ctx);
      await ctx.reply(localText(locale, '已退出隐私聊天，临时上下文已清除。', 'Private chat exited and temporary context cleared.'), this.createBottomKeyboard(locale));
      return true;
    }

    if (Date.now() >= Number(mode.expiresAt || 0)) {
      this.clearActiveMode(ctx);
      await ctx.reply(
        localText(locale, '隐私会话已因长时间无操作自动清除。请重新开启。', 'The private session expired and was cleared. Please enable it again.'),
        this.createPrivacyPanelKeyboard(locale)
      );
      return true;
    }

    if (ctx.chat?.type !== 'private') {
      this.clearActiveMode(ctx);
      await ctx.reply(localText(locale, '隐私聊天只能在私聊中使用。', 'Private chat is only available in direct messages.'));
      return true;
    }

    if (ctx.message?.photo || ctx.message?.voice || ctx.message?.audio || ctx.message?.document || ctx.message?.video || ctx.message?.sticker) {
      await ctx.reply(
        localText(
          locale,
          '为减少额外上传，隐私聊天当前只处理纯文字。图片、语音、文件和视频不会被下载或发送给模型。',
          'To reduce additional uploads, private chat currently accepts text only. Images, voice, files, and video are not downloaded or sent to the model.'
        ),
        this.createPrivacyModeKeyboard(locale, mode.contextMode)
      );
      return true;
    }

    const text = truncateText(input, this.config.maxInputChars);
    if (!text) {
      await ctx.reply(localText(locale, '请发送纯文字内容。', 'Please send a text message.'), this.createPrivacyModeKeyboard(locale, mode.contextMode));
      return true;
    }

    if (!this.isAllowed(ctx)) {
      await ctx.reply(this.t(locale, 'noAccess'));
      return true;
    }

    if (!this.checkRateLimit(ctx.from.id)) {
      await ctx.reply(this.t(locale, 'rateLimited'));
      return true;
    }

    if (Number(mode.messageCount || 0) >= this.privacyConfig.maxSessionMessages) {
      this.clearActiveMode(ctx);
      await ctx.reply(
        localText(locale, '本次隐私会话已达到消息上限并自动清除。请重新开启。', 'This private session reached its message limit and was cleared. Please enable it again.'),
        this.createPrivacyPanelKeyboard(locale)
      );
      return true;
    }

    const user = this.db.findUser(ctx.from?.id);
    const aiSettings = this.getEffectiveAISettings(ctx.from?.id);
    const model = aiSettings.modelId || user?.preferredModel || this.config.defaultModel;
    const ephemeralHistory = mode.contextMode === 'temporary'
      ? trimEphemeralHistory(mode.messages, this.privacyConfig.maxContextMessages, this.privacyConfig.maxContextChars)
      : [];
    const userMessage = { role: 'user', content: text };
    const messages = [
      { role: 'system', content: createPrivacySystemPrompt(this.config, user, locale) },
      ...ephemeralHistory,
      userMessage
    ];

    try {
      await ctx.sendChatAction('typing');
      const completion = await this.completeWithAiFallback({
        scope: 'privacy_chat',
        capability: 'chat',
        userId: ctx.from.id,
        preferredProvider: aiSettings.providerId,
        fallbackEnabled: false,
        model,
        locale,
        request: {
          messages,
          tools: []
        }
      });
      const result = this.normalizeAiResult(completion.result, messages);
      const assistantText = result.text || this.t(locale, 'noReply');

      if (mode.contextMode === 'temporary') {
        mode.messages = trimEphemeralHistory(
          [...ephemeralHistory, userMessage, { role: 'assistant', content: assistantText }],
          this.privacyConfig.maxContextMessages,
          this.privacyConfig.maxContextChars
        );
      } else {
        this.wipePrivacyMessages(mode);
      }

      mode.messageCount = Number(mode.messageCount || 0) + 1;
      mode.lastActivityAt = Date.now();
      mode.expiresAt = Date.now() + this.privacyConfig.ttlMs;

      await this.sendAssistantReply(ctx, assistantText, this.createPrivacyModeKeyboard(locale, mode.contextMode));
    } catch (error) {
      this.logger?.warn?.('Privacy chat request failed', safeErrorMeta(error));
      await ctx.reply(this.formatUserFacingError(error, locale), this.createPrivacyModeKeyboard(locale, mode.contextMode));
    }

    return true;
  }

  async stop(reason) {
    clearInterval(this.privacySweepTimer);
    for (const mode of this.activeModes.values()) {
      if (mode?.type === 'privacy') this.wipePrivacyMessages(mode);
    }
    return super.stop(reason);
  }
}

export const privacyInternals = {
  readPositiveInteger,
  trimEphemeralHistory,
  createPrivacySystemPrompt,
  safeErrorMeta
};
