import { Markup, Telegraf } from 'telegraf';
import { buildConversationHistory } from '../utils/conversation.js';
import {
  extractCommandArgs,
  normalizeCommand,
  normalizeLanguageCode,
  shouldRespondToMessage
} from '../utils/telegram.js';
import { extractUrls, splitMessage, toDataUri, truncateText } from '../utils/text.js';
import { personaPresets } from '../config.js';

const SUPPORTED_TEXT_FILE_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'application/xml',
  'text/xml'
]);

const LANGUAGE_NAMES = {
  zh: '中文',
  en: 'English'
};

const LANGUAGE_PROMPTS = {
  zh: 'Always answer in Simplified Chinese unless the user explicitly asks for another language.',
  en: 'Always answer in English unless the user explicitly asks for another language.'
};

const UI_TEXT = {
  zh: {
    helpTitle: '可用能力：',
    featureConversation: '- 文本对话：私聊直接发消息，群聊支持 @我 / 回复我 / 关键词触发',
    featureReset: '- /reset 或 /clear：清空当前会话记忆',
    featureModels: '- /models：查看可用模型',
    featureModel: '- /model [name]：切换当前用户默认模型',
    featurePersona: '- /persona [default|coder|translator|teacher|writer]：切换人格',
    featureLanguage: '- /language [zh|en]：切换机器人界面语言',
    featureButtons: '- 可直接点击下方按钮，也支持自然语言如“搜索 xxx”“生成图片 xxx”',
    featureWeb: '- /web [query]：联网搜索',
    featureImage: '- /image [prompt]：生成图片',
    featureTts: '- /tts [text]：生成语音',
    featurePhoto: '- 直接发送图片：自动识别图片内容',
    featureVoice: '- 直接发送语音：自动转文字并继续对话',
    featureDocument: '- 发送文本文件：自动读取并总结',
    featureChatmode: '- /chatmode [smart|all|mention|reply|keyword]：群聊触发模式',
    featureKeyword: '- /keyword [text]：设置群聊关键词',
    featureStats: '- /stats：查看统计信息',
    featureAdmin: '- 管理员：/block /unblock /allow /disallow [userId]',
    start: '你好，我已经准备好了。你可以直接发消息，也可以点按钮使用常用功能。发送 /help 查看详细说明。',
    memoryCleared: '当前会话记忆已清空。',
    currentModel: '当前模型：{model}',
    availableModels: '可用模型：{models}',
    modelUnavailable: '模型不可用。可选：{models}',
    modelSwitched: '已切换到模型：{model}',
    currentPersona: '当前人格：{persona}\n可选：{options}',
    personaUnsupported: '不支持的人格。可选：{options}',
    personaSwitched: '已切换人格：{persona}',
    webUsage: '用法：/web 你的搜索关键词',
    webResult: '联网搜索结果：\n{result}',
    searchFailed: '搜索失败：{error}',
    imageUsage: '用法：/image 你的图片描述',
    imageUnsupported: '当前提供商 {provider} 不支持图片生成。请切换到支持图片能力的平台。',
    imageEmpty: '图片接口返回了空结果。',
    imageFailed: '图片生成失败：{error}',
    ttsUsage: '用法：/tts 你想转换成语音的文本',
    ttsUnsupported: '当前提供商 {provider} 不支持文字转语音。请切换到支持语音能力的平台。',
    ttsFailed: 'TTS 失败：{error}',
    personalStats: '你的今日额度已用：{used}/{quota}\n累计消息：{total}',
    globalStats: '全局统计：',
    privateOnlyCommand: '该命令仅用于群聊。',
    chatmodeUsage: '用法：/chatmode {modes}',
    chatmodeSet: '群聊触发模式已设置为：{mode}',
    keywordUsage: '用法：/keyword 触发关键词',
    keywordSet: '群聊触发关键词已设置为：{keyword}',
    adminOnly: '只有管理员可以执行此命令。',
    blockUsage: '用法：/{command} 用户ID',
    allowUsage: '用法：/{command} 用户ID',
    blockDone: '已封禁用户：{userId}',
    unblockDone: '已解除封禁：{userId}',
    allowDone: '已放行用户：{userId}',
    disallowDone: '已取消放行：{userId}',
    noAccess: '你当前没有使用权限。',
    rateLimited: '请求过于频繁，请稍后再试。',
    quotaExceeded: '你今天的使用额度已经用完，请明天再来。',
    messageFailed: '处理消息失败：{error}',
    noReply: '抱歉，这次没有拿到有效回复。',
    noTranscriptionSupport:
      '用户发送了语音消息，但当前模型提供商不支持语音转文字。请提醒用户改发文字，或切换支持语音转写的平台。',
    unsupportedDocument:
      '用户上传了一个名为 {filename}、类型为 {mimeType} 的文件。请说明当前仅支持直接总结文本类文件。',
    continuePrompt: '请继续。',
    menu: '常用功能按钮已显示在下方。',
    currentLanguage: '当前语言：{language}',
    languageUsage: '用法：/language zh 或 /language en',
    languageUnsupported: '暂不支持该语言。可选：zh, en',
    languageSet: '已切换语言：{language}',
    languagePrompt: '请选择机器人界面语言：',
    modelsPrompt: '请选择模型：',
    personaPrompt: '请选择人格：',
    buttonHelp: '🆘 帮助',
    buttonReset: '🧹 清空记忆',
    buttonModels: '🤖 模型',
    buttonPersona: '🎭 人格',
    buttonWeb: '🌐 联网搜索',
    buttonImage: '🖼️ 生成图片',
    buttonTts: '🔊 语音朗读',
    buttonLanguage: '🌍 语言'
  },
  en: {
    helpTitle: 'Available features:',
    featureConversation: '- Chat directly in private; groups support @mention, reply, or keyword triggers',
    featureReset: '- /reset or /clear: clear the current conversation memory',
    featureModels: '- /models: list available models',
    featureModel: '- /model [name]: switch your default model',
    featurePersona: '- /persona [default|coder|translator|teacher|writer]: switch persona',
    featureLanguage: '- /language [zh|en]: switch bot UI language',
    featureButtons: '- You can tap the buttons below, or use natural requests like "search ..." or "generate an image ..."',
    featureWeb: '- /web [query]: web search',
    featureImage: '- /image [prompt]: generate an image',
    featureTts: '- /tts [text]: text to speech',
    featurePhoto: '- Send a photo directly: auto image understanding',
    featureVoice: '- Send voice directly: auto transcription and continue chatting',
    featureDocument: '- Send a text file: auto read and summarize',
    featureChatmode: '- /chatmode [smart|all|mention|reply|keyword]: group trigger mode',
    featureKeyword: '- /keyword [text]: set group trigger keyword',
    featureStats: '- /stats: view usage stats',
    featureAdmin: '- Admin: /block /unblock /allow /disallow [userId]',
    start: 'Hi, I am ready. You can chat directly or tap the buttons for common actions. Send /help for details.',
    memoryCleared: 'The current conversation memory has been cleared.',
    currentModel: 'Current model: {model}',
    availableModels: 'Available models: {models}',
    modelUnavailable: 'Model unavailable. Options: {models}',
    modelSwitched: 'Switched to model: {model}',
    currentPersona: 'Current persona: {persona}\nOptions: {options}',
    personaUnsupported: 'Unsupported persona. Options: {options}',
    personaSwitched: 'Switched persona: {persona}',
    webUsage: 'Usage: /web your search query',
    webResult: 'Web search result:\n{result}',
    searchFailed: 'Search failed: {error}',
    imageUsage: 'Usage: /image your prompt',
    imageUnsupported: 'The current provider {provider} does not support image generation. Please switch to a provider that does.',
    imageEmpty: 'The image API returned an empty result.',
    imageFailed: 'Image generation failed: {error}',
    ttsUsage: 'Usage: /tts the text you want to speak',
    ttsUnsupported: 'The current provider {provider} does not support text-to-speech. Please switch to a provider that does.',
    ttsFailed: 'TTS failed: {error}',
    personalStats: 'Today used: {used}/{quota}\nTotal messages: {total}',
    globalStats: 'Global stats:',
    privateOnlyCommand: 'This command is only for group chats.',
    chatmodeUsage: 'Usage: /chatmode {modes}',
    chatmodeSet: 'Group trigger mode set to: {mode}',
    keywordUsage: 'Usage: /keyword trigger keyword',
    keywordSet: 'Group trigger keyword set to: {keyword}',
    adminOnly: 'Only admins can use this command.',
    blockUsage: 'Usage: /{command} userId',
    allowUsage: 'Usage: /{command} userId',
    blockDone: 'Blocked user: {userId}',
    unblockDone: 'Unblocked user: {userId}',
    allowDone: 'Allowed user: {userId}',
    disallowDone: 'Disallowed user: {userId}',
    noAccess: 'You do not have permission to use the bot right now.',
    rateLimited: 'Too many requests. Please try again later.',
    quotaExceeded: 'You have used up today’s quota. Please come back tomorrow.',
    messageFailed: 'Failed to handle message: {error}',
    noReply: 'Sorry, no valid reply was returned this time.',
    noTranscriptionSupport:
      'The user sent a voice message, but the current provider does not support speech-to-text. Tell the user to send text instead or switch providers.',
    unsupportedDocument:
      'The user uploaded a file named {filename} with type {mimeType}. Explain that only text-like files are summarized directly right now.',
    continuePrompt: 'Please continue.',
    menu: 'Common action buttons are shown below.',
    currentLanguage: 'Current language: {language}',
    languageUsage: 'Usage: /language zh or /language en',
    languageUnsupported: 'Unsupported language. Options: zh, en',
    languageSet: 'Switched language to: {language}',
    languagePrompt: 'Choose the bot UI language:',
    modelsPrompt: 'Choose a model:',
    personaPrompt: 'Choose a persona:',
    buttonHelp: '🆘 Help',
    buttonReset: '🧹 Clear Memory',
    buttonModels: '🤖 Models',
    buttonPersona: '🎭 Persona',
    buttonWeb: '🌐 Web Search',
    buttonImage: '🖼️ Image',
    buttonTts: '🔊 TTS',
    buttonLanguage: '🌍 Language'
  }
};

function formatText(template, params = {}) {
  return Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function createSystemPrompt(config, chatSettings, userSettings, locale) {
  const personaPrompt = userSettings.customSystemPrompt || personaPresets[userSettings.persona] || config.systemPrompt;
  const chatPrompt = chatSettings.systemPrompt ? `\n\nChat instructions: ${chatSettings.systemPrompt}` : '';
  const languagePrompt = LANGUAGE_PROMPTS[locale] || LANGUAGE_PROMPTS.zh;
  return `${personaPrompt}${chatPrompt}\n\n${languagePrompt}`.trim();
}

function createSessionId(ctx) {
  const chatId = String(ctx.chat.id);
  const userId = String(ctx.from?.id || 'anonymous');
  const threadId = ctx.message?.message_thread_id ? String(ctx.message.message_thread_id) : 'main';
  return `${chatId}:${userId}:${threadId}`;
}

async function sendTextReply(ctx, text, maxLength, extra = {}) {
  const chunks = splitMessage(text, maxLength);
  for (const chunk of chunks) {
    await ctx.reply(chunk, {
      ...extra,
      reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined
    });
  }
}

async function readTelegramFile(ctx, fileId, fallbackName, mimeType) {
  const url = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    filename: fallbackName,
    mimeType
  };
}

function chunkItems(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export class TelegramAIBot {
  constructor({ config, db, aiClient, toolRegistry, logger }) {
    this.config = config;
    this.db = db;
    this.aiClient = aiClient;
    this.toolRegistry = toolRegistry;
    this.logger = logger;
    this.rateLimits = new Map();
    this.bot = new Telegraf(config.botToken);
    this.botUsername = '';
  }

  getLocale(ctx, user = this.db.findUser(ctx.from?.id)) {
    return user?.preferredLanguage || normalizeLanguageCode(ctx.from?.language_code, 'zh');
  }

  t(locale, key, params = {}) {
    const dictionary = UI_TEXT[locale] || UI_TEXT.zh;
    return formatText(dictionary[key] || UI_TEXT.zh[key] || key, params);
  }

  getMenuLabels(locale) {
    return {
      help: this.t(locale, 'buttonHelp'),
      reset: this.t(locale, 'buttonReset'),
      models: this.t(locale, 'buttonModels'),
      persona: this.t(locale, 'buttonPersona'),
      web: this.t(locale, 'buttonWeb'),
      image: this.t(locale, 'buttonImage'),
      tts: this.t(locale, 'buttonTts'),
      language: this.t(locale, 'buttonLanguage')
    };
  }

  createMenuKeyboard(locale) {
    const labels = this.getMenuLabels(locale);
    return Markup.keyboard([
      [labels.help, labels.reset],
      [labels.models, labels.persona],
      [labels.web, labels.image],
      [labels.tts, labels.language]
    ]).resize();
  }

  createModelKeyboard(currentModel) {
    const buttons = this.config.availableModels.map((model) =>
      Markup.button.callback(model === currentModel ? `✅ ${model}` : model, `set_model:${model}`)
    );
    return Markup.inlineKeyboard(chunkItems(buttons, 2));
  }

  createPersonaKeyboard(currentPersona) {
    const buttons = Object.keys(personaPresets).map((persona) =>
      Markup.button.callback(
        persona === currentPersona ? `✅ ${persona}` : persona,
        `set_persona:${persona}`
      )
    );
    return Markup.inlineKeyboard(chunkItems(buttons, 2));
  }

  createLanguageKeyboard(currentLanguage) {
    const buttons = Object.entries(LANGUAGE_NAMES).map(([code, name]) =>
      Markup.button.callback(
        code === currentLanguage ? `✅ ${name}` : name,
        `set_language:${code}`
      )
    );
    return Markup.inlineKeyboard(chunkItems(buttons, 2));
  }

  parseNaturalLanguageAction(text = '', locale = 'zh') {
    const content = text.trim();
    if (!content) return null;

    const menuLabels = this.getMenuLabels(locale);
    const buttonMap = new Map([
      [menuLabels.help, { type: 'help' }],
      [menuLabels.reset, { type: 'reset' }],
      [menuLabels.models, { type: 'models' }],
      [menuLabels.persona, { type: 'persona' }],
      [menuLabels.web, { type: 'web_prompt' }],
      [menuLabels.image, { type: 'image_prompt' }],
      [menuLabels.tts, { type: 'tts_prompt' }],
      [menuLabels.language, { type: 'language' }]
    ]);
    if (buttonMap.has(content)) {
      return buttonMap.get(content);
    }

    if (/^(help|menu|帮助|幫助|菜单|選單)$/i.test(content)) return { type: 'help' };
    if (/^(reset|clear|清空|重置)(对话|對話|会话|會話|记忆|記憶)?$/i.test(content)) return { type: 'reset' };
    if (/^(models?|模型(列表)?)$/i.test(content)) return { type: 'models' };
    if (/^(persona|人格)$/i.test(content)) return { type: 'persona' };
    if (/^(language|语言|語言)$/i.test(content)) return { type: 'language' };

    const actionPatterns = [
      { type: 'web', regex: /^(?:web|search|搜索|联网搜索|上网搜)\s+(.+)$/i },
      { type: 'image', regex: /^(?:image|draw|paint|生成图片|生成圖像|画|畫)\s+(.+)$/i },
      { type: 'tts', regex: /^(?:tts|speak|read aloud|语音朗读|朗读|转语音|轉語音)\s+(.+)$/i },
      { type: 'model', regex: /^(?:set model|use model|切换模型|切換模型|模型切换|模型切換)\s+(.+)$/i },
      { type: 'persona_set', regex: /^(?:set persona|use persona|切换人格|切換人格|人格切换|人格切換)\s+(.+)$/i },
      { type: 'language_set', regex: /^(?:set language|switch language|切换语言|切換語言|语言切换|語言切換)\s+(.+)$/i }
    ];

    for (const pattern of actionPatterns) {
      const match = content.match(pattern.regex);
      if (match) {
        return { type: pattern.type, value: match[1].trim() };
      }
    }

    return null;
  }

  normalizeLanguageInput(value = '') {
    const normalized = String(value).trim().toLowerCase();
    const baseLanguage = normalizeLanguageCode(normalized, '');
    if (baseLanguage) {
      return baseLanguage;
    }
    if (['zh', 'zh-cn', 'zh-hans', 'chinese', '中文', '简体中文', '簡體中文'].includes(normalized)) {
      return 'zh';
    }
    if (['en', 'en-us', 'en-gb', 'english', '英语', '英文', '英語'].includes(normalized)) {
      return 'en';
    }
    return '';
  }

  getProviderCapabilities() {
    return (
      this.aiClient.getCapabilities?.() || {
        chat: true,
        toolCalls: true,
        imageGeneration: true,
        speechSynthesis: true,
        speechTranscription: true
      }
    );
  }

  getProviderName() {
    return this.aiClient.getProviderName?.() || this.config.aiProvider || 'unknown';
  }

  async init() {
    this.bot.catch((error, ctx) => {
      this.logger.error('Telegram handler error', { chatId: ctx.chat?.id, error });
    });

    this.bot.use(async (ctx, next) => {
      if (ctx.from) {
        const isAdmin = this.config.adminUserIds.has(String(ctx.from.id));
        await this.db.upsertUser(ctx.from, { isAdmin });
      }
      if (ctx.chat) {
        const chat = await this.db.upsertChat(ctx.chat, {
          triggerMode: this.config.groupTriggerMode,
          keyword: this.config.groupTriggerKeyword
        });
        if (!chat.keyword) {
          await this.db.setChatSettings(ctx.chat.id, { keyword: this.config.groupTriggerKeyword, triggerMode: this.config.groupTriggerMode });
        }
      }
      return next();
    });

    this.registerCommands();
    this.bot.on('message', (ctx) => this.handleIncomingMessage(ctx));

    const me = await this.bot.telegram.getMe();
    this.botUsername = me.username || '';
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'Show help' },
      { command: 'reset', description: 'Clear current conversation memory' },
      { command: 'model', description: 'View or set the current model' },
      { command: 'models', description: 'List available models' },
      { command: 'language', description: 'View or set the bot UI language' },
      { command: 'menu', description: 'Show common action buttons' },
      { command: 'persona', description: 'View or set persona' },
      { command: 'web', description: 'Search the web' },
      { command: 'image', description: 'Generate an image' },
      { command: 'tts', description: 'Convert text to speech' },
      { command: 'stats', description: 'Show usage statistics' }
    ]);
  }

  registerCommands() {
    this.bot.command('start', (ctx) => this.handleStart(ctx));
    this.bot.command('help', (ctx) => this.handleHelp(ctx));
    this.bot.command(['reset', 'clear'], (ctx) => this.handleReset(ctx));
    this.bot.command('models', (ctx) => this.handleModels(ctx));
    this.bot.command('model', (ctx) => this.handleModel(ctx));
    this.bot.command('menu', (ctx) => this.handleMenu(ctx));
    this.bot.command('language', (ctx) => this.handleLanguage(ctx));
    this.bot.command('persona', (ctx) => this.handlePersona(ctx));
    this.bot.command('web', (ctx) => this.handleWeb(ctx));
    this.bot.command('image', (ctx) => this.handleImage(ctx));
    this.bot.command('tts', (ctx) => this.handleTts(ctx));
    this.bot.command('stats', (ctx) => this.handleStats(ctx));
    this.bot.command('chatmode', (ctx) => this.handleChatMode(ctx));
    this.bot.command('keyword', (ctx) => this.handleKeyword(ctx));
    this.bot.command('block', (ctx) => this.handleBlock(ctx, true));
    this.bot.command('unblock', (ctx) => this.handleBlock(ctx, false));
    this.bot.command('allow', (ctx) => this.handleAllow(ctx, true));
    this.bot.command('disallow', (ctx) => this.handleAllow(ctx, false));
    this.bot.action(/^set_model:(.+)$/, (ctx) => this.handleModelCallback(ctx));
    this.bot.action(/^set_persona:(.+)$/, (ctx) => this.handlePersonaCallback(ctx));
    this.bot.action(/^set_language:(.+)$/, (ctx) => this.handleLanguageCallback(ctx));
  }

  isAdmin(ctx) {
    return this.config.adminUserIds.has(String(ctx.from?.id));
  }

  isAllowed(ctx) {
    const userId = String(ctx.from?.id || '');
    const chatId = String(ctx.chat?.id || '');
    const user = this.db.findUser(userId);

    if (this.config.blockedUserIds.has(userId) || user?.isBlocked) return false;
    if (this.config.allowedChatIds.size > 0 && !this.config.allowedChatIds.has(chatId)) return false;
    if (this.config.allowedUserIds.size > 0) {
      return this.config.allowedUserIds.has(userId) || user?.isAllowed || this.isAdmin(ctx);
    }
    return true;
  }

  checkRateLimit(userId) {
    const now = Date.now();
    const key = String(userId);
    const hits = (this.rateLimits.get(key) || []).filter((value) => now - value < this.config.rateLimitWindowMs);
    if (hits.length >= this.config.rateLimitMaxRequests) {
      this.rateLimits.set(key, hits);
      return false;
    }
    hits.push(now);
    this.rateLimits.set(key, hits);
    return true;
  }

  async handleStart(ctx) {
    const locale = this.getLocale(ctx);
    await sendTextReply(
      ctx,
      this.t(locale, 'start'),
      this.config.maxOutputChars,
      this.createMenuKeyboard(locale)
    );
  }

  async handleHelp(ctx) {
    const locale = this.getLocale(ctx);
    const helpText = [
      this.t(locale, 'helpTitle'),
      this.t(locale, 'featureConversation'),
      this.t(locale, 'featureReset'),
      this.t(locale, 'featureModels'),
      this.t(locale, 'featureModel'),
      this.t(locale, 'featurePersona'),
      this.t(locale, 'featureLanguage'),
      this.t(locale, 'featureButtons'),
      this.t(locale, 'featureWeb'),
      this.t(locale, 'featureImage'),
      this.t(locale, 'featureTts'),
      this.t(locale, 'featurePhoto'),
      this.t(locale, 'featureVoice'),
      this.t(locale, 'featureDocument'),
      this.t(locale, 'featureChatmode'),
      this.t(locale, 'featureKeyword'),
      this.t(locale, 'featureStats'),
      this.t(locale, 'featureAdmin')
    ].join('\n');

    await sendTextReply(ctx, helpText, this.config.maxOutputChars, this.createMenuKeyboard(locale));
  }

  async handleReset(ctx) {
    await this.db.clearConversation(createSessionId(ctx));
    const locale = this.getLocale(ctx);
    await ctx.reply(this.t(locale, 'memoryCleared'), this.createMenuKeyboard(locale));
  }

  async handleMenu(ctx) {
    const locale = this.getLocale(ctx);
    await ctx.reply(this.t(locale, 'menu'), this.createMenuKeyboard(locale));
  }

  async handleModels(ctx) {
    const user = this.db.findUser(ctx.from.id);
    const locale = this.getLocale(ctx, user);
    const current = user?.preferredModel || this.config.defaultModel;
    const models = this.config.availableModels.length > 0 ? this.config.availableModels.join(', ') : this.config.defaultModel;
    await ctx.reply(
      `${this.t(locale, 'currentModel', { model: current })}\n${this.t(locale, 'availableModels', { models })}`,
      this.createModelKeyboard(current)
    );
  }

  async handleModel(ctx) {
    const arg = extractCommandArgs(ctx.message.text || '');
    const user = this.db.findUser(ctx.from.id);
    const locale = this.getLocale(ctx, user);

    if (!arg) {
      await ctx.reply(
        this.t(locale, 'currentModel', { model: user?.preferredModel || this.config.defaultModel }),
        this.createModelKeyboard(user?.preferredModel || this.config.defaultModel)
      );
      return;
    }

    if (!this.config.availableModels.includes(arg)) {
      await ctx.reply(
        this.t(locale, 'modelUnavailable', { models: this.config.availableModels.join(', ') }),
        this.createModelKeyboard(user?.preferredModel || this.config.defaultModel)
      );
      return;
    }

    await this.db.setUserSettings(ctx.from.id, { preferredModel: arg });
    await ctx.reply(this.t(locale, 'modelSwitched', { model: arg }), this.createModelKeyboard(arg));
  }

  async handlePersona(ctx) {
    const arg = extractCommandArgs(ctx.message.text || '');
    const user = this.db.findUser(ctx.from.id);
    const locale = this.getLocale(ctx, user);

    if (!arg) {
      await ctx.reply(
        this.t(locale, 'currentPersona', {
          persona: user?.persona || 'default',
          options: Object.keys(personaPresets).join(', ')
        }),
        this.createPersonaKeyboard(user?.persona || 'default')
      );
      return;
    }

    if (!(arg in personaPresets)) {
      await ctx.reply(
        this.t(locale, 'personaUnsupported', { options: Object.keys(personaPresets).join(', ') }),
        this.createPersonaKeyboard(user?.persona || 'default')
      );
      return;
    }

    await this.db.setUserSettings(ctx.from.id, { persona: arg, customSystemPrompt: '' });
    await ctx.reply(this.t(locale, 'personaSwitched', { persona: arg }), this.createPersonaKeyboard(arg));
  }

  async handleLanguage(ctx) {
    const rawArg = extractCommandArgs(ctx.message.text || '');
    const arg = this.normalizeLanguageInput(rawArg);
    const user = this.db.findUser(ctx.from.id);
    const locale = this.getLocale(ctx, user);

    if (!rawArg) {
      await ctx.reply(
        this.t(locale, 'currentLanguage', { language: LANGUAGE_NAMES[locale] || locale }),
        this.createLanguageKeyboard(locale)
      );
      return;
    }

    if (!arg) {
      await ctx.reply(this.t(locale, 'languageUnsupported'), this.createLanguageKeyboard(locale));
      return;
    }

    await this.db.setUserSettings(ctx.from.id, { preferredLanguage: arg });
    await ctx.reply(
      this.t(arg, 'languageSet', { language: LANGUAGE_NAMES[arg] || arg }),
      this.createMenuKeyboard(arg)
    );
  }

  async handleWeb(ctx) {
    const query = extractCommandArgs(ctx.message.text || '');
    const locale = this.getLocale(ctx);
    if (!query) {
      await ctx.reply(this.t(locale, 'webUsage'));
      return;
    }

    try {
      await ctx.sendChatAction('typing');
      const raw = await this.toolRegistry.execute({
        function: {
          name: 'web_search',
          arguments: JSON.stringify({ query })
        }
      });
      await this.db.incrementStats('toolCalls');
      await sendTextReply(ctx, this.t(locale, 'webResult', { result: raw }), this.config.maxOutputChars);
    } catch (error) {
      await ctx.reply(this.t(locale, 'searchFailed', { error: error.message }));
    }
  }

  async handleImage(ctx) {
    const prompt = extractCommandArgs(ctx.message.text || '');
    const locale = this.getLocale(ctx);
    if (!prompt) {
      await ctx.reply(this.t(locale, 'imageUsage'));
      return;
    }

    const capabilities = this.getProviderCapabilities();
    if (!capabilities.imageGeneration) {
      await ctx.reply(this.t(locale, 'imageUnsupported', { provider: this.getProviderName() }));
      return;
    }

    try {
      await ctx.sendChatAction('upload_photo');
      const response = await this.aiClient.generateImage({ prompt });
      await this.db.incrementStats('aiCalls');
      await this.db.incrementStats('imageGenerations');
      const item = response.data?.[0];
      if (item?.url) {
        await ctx.replyWithPhoto(item.url, { caption: prompt });
        return;
      }
      if (item?.b64_json) {
        await ctx.replyWithPhoto({ source: Buffer.from(item.b64_json, 'base64') }, { caption: prompt });
        return;
      }
      await ctx.reply(this.t(locale, 'imageEmpty'));
    } catch (error) {
      await ctx.reply(this.t(locale, 'imageFailed', { error: error.message }));
    }
  }

  async handleTts(ctx) {
    const text = extractCommandArgs(ctx.message.text || '');
    const locale = this.getLocale(ctx);
    if (!text) {
      await ctx.reply(this.t(locale, 'ttsUsage'));
      return;
    }

    const capabilities = this.getProviderCapabilities();
    if (!capabilities.speechSynthesis) {
      await ctx.reply(this.t(locale, 'ttsUnsupported', { provider: this.getProviderName() }));
      return;
    }

    try {
      await ctx.sendChatAction('record_voice');
      const audio = await this.aiClient.generateSpeech({ input: truncateText(text, 4000) });
      await this.db.incrementStats('aiCalls');
      await this.db.incrementStats('ttsGenerations');
      await ctx.replyWithAudio({ source: audio, filename: 'speech.mp3' });
    } catch (error) {
      await ctx.reply(this.t(locale, 'ttsFailed', { error: error.message }));
    }
  }

  async handleStats(ctx) {
    const stats = this.db.getStats();
    const user = this.db.findUser(ctx.from.id);
    const locale = this.getLocale(ctx, user);
    if (!this.isAdmin(ctx)) {
      await ctx.reply(
        this.t(locale, 'personalStats', {
          used: user?.dailyUsageCount || 0,
          quota: this.config.dailyQuota,
          total: user?.totalMessages || 0
        })
      );
      return;
    }

    await ctx.reply(
      [
        this.t(locale, 'globalStats'),
        `- messagesHandled: ${stats.messagesHandled}`,
        `- aiCalls: ${stats.aiCalls}`,
        `- toolCalls: ${stats.toolCalls}`,
        `- voiceTranscriptions: ${stats.voiceTranscriptions}`,
        `- imageGenerations: ${stats.imageGenerations}`,
        `- ttsGenerations: ${stats.ttsGenerations}`
      ].join('\n')
    );
  }

  async handleChatMode(ctx) {
    const locale = this.getLocale(ctx);
    if (ctx.chat.type === 'private') {
      await ctx.reply(this.t(locale, 'privateOnlyCommand'));
      return;
    }

    const mode = extractCommandArgs(ctx.message.text || '');
    const allowed = ['smart', 'all', 'mention', 'reply', 'keyword'];
    if (!mode || !allowed.includes(mode)) {
      await ctx.reply(this.t(locale, 'chatmodeUsage', { modes: allowed.join('|') }));
      return;
    }

    await this.db.setChatSettings(ctx.chat.id, { triggerMode: mode });
    await ctx.reply(this.t(locale, 'chatmodeSet', { mode }));
  }

  async handleKeyword(ctx) {
    const locale = this.getLocale(ctx);
    if (ctx.chat.type === 'private') {
      await ctx.reply(this.t(locale, 'privateOnlyCommand'));
      return;
    }

    const keyword = extractCommandArgs(ctx.message.text || '');
    if (!keyword) {
      await ctx.reply(this.t(locale, 'keywordUsage'));
      return;
    }

    await this.db.setChatSettings(ctx.chat.id, { keyword });
    await ctx.reply(this.t(locale, 'keywordSet', { keyword }));
  }

  async handleBlock(ctx, blocked) {
    const locale = this.getLocale(ctx);
    if (!this.isAdmin(ctx)) {
      await ctx.reply(this.t(locale, 'adminOnly'));
      return;
    }

    const userId = extractCommandArgs(ctx.message.text || '');
    if (!userId) {
      await ctx.reply(this.t(locale, 'blockUsage', { command: blocked ? 'block' : 'unblock' }));
      return;
    }

    await this.db.setUserSettings(userId, { isBlocked: blocked });
    await ctx.reply(blocked ? this.t(locale, 'blockDone', { userId }) : this.t(locale, 'unblockDone', { userId }));
  }

  async handleAllow(ctx, allowed) {
    const locale = this.getLocale(ctx);
    if (!this.isAdmin(ctx)) {
      await ctx.reply(this.t(locale, 'adminOnly'));
      return;
    }

    const userId = extractCommandArgs(ctx.message.text || '');
    if (!userId) {
      await ctx.reply(this.t(locale, 'allowUsage', { command: allowed ? 'allow' : 'disallow' }));
      return;
    }

    await this.db.setUserSettings(userId, { isAllowed: allowed });
    await ctx.reply(allowed ? this.t(locale, 'allowDone', { userId }) : this.t(locale, 'disallowDone', { userId }));
  }

  async handleModelCallback(ctx) {
    const model = ctx.match[1];
    const locale = this.getLocale(ctx);
    await ctx.answerCbQuery();
    if (!this.config.availableModels.includes(model)) {
      await ctx.reply(this.t(locale, 'modelUnavailable', { models: this.config.availableModels.join(', ') }));
      return;
    }
    await this.db.setUserSettings(ctx.from.id, { preferredModel: model });
    await ctx.reply(this.t(locale, 'modelSwitched', { model }), this.createModelKeyboard(model));
  }

  async handlePersonaCallback(ctx) {
    const persona = ctx.match[1];
    const locale = this.getLocale(ctx);
    await ctx.answerCbQuery();
    if (!(persona in personaPresets)) {
      await ctx.reply(this.t(locale, 'personaUnsupported', { options: Object.keys(personaPresets).join(', ') }));
      return;
    }
    await this.db.setUserSettings(ctx.from.id, { persona, customSystemPrompt: '' });
    await ctx.reply(this.t(locale, 'personaSwitched', { persona }), this.createPersonaKeyboard(persona));
  }

  async handleLanguageCallback(ctx) {
    const language = this.normalizeLanguageInput(ctx.match[1]);
    const locale = this.getLocale(ctx);
    await ctx.answerCbQuery();
    if (!language) {
      await ctx.reply(this.t(locale, 'languageUnsupported'));
      return;
    }
    await this.db.setUserSettings(ctx.from.id, { preferredLanguage: language });
    await ctx.reply(
      this.t(language, 'languageSet', { language: LANGUAGE_NAMES[language] || language }),
      this.createMenuKeyboard(language)
    );
  }

  async handleIncomingMessage(ctx) {
    const text = ctx.message.text || '';
    const caption = ctx.message.caption || '';
    const command = normalizeCommand(text);
    if (command.startsWith('/')) {
      return;
    }

    const user = this.db.findUser(ctx.from.id);
    const chat = this.db.findChat(ctx.chat.id);
    const locale = this.getLocale(ctx, user);
    const naturalAction = text ? this.parseNaturalLanguageAction(text, locale) : null;

    if (naturalAction) {
      if (naturalAction.type === 'help') return this.handleHelp(ctx);
      if (naturalAction.type === 'reset') return this.handleReset(ctx);
      if (naturalAction.type === 'models') return this.handleModels(ctx);
      if (naturalAction.type === 'persona') return this.handlePersona(ctx);
      if (naturalAction.type === 'language') return this.handleLanguage(ctx);
      if (naturalAction.type === 'web_prompt') return ctx.reply(this.t(locale, 'webUsage'));
      if (naturalAction.type === 'image_prompt') return ctx.reply(this.t(locale, 'imageUsage'));
      if (naturalAction.type === 'tts_prompt') return ctx.reply(this.t(locale, 'ttsUsage'));
      if (naturalAction.type === 'web') {
        ctx.message.text = `/web ${naturalAction.value}`;
        return this.handleWeb(ctx);
      }
      if (naturalAction.type === 'image') {
        ctx.message.text = `/image ${naturalAction.value}`;
        return this.handleImage(ctx);
      }
      if (naturalAction.type === 'tts') {
        ctx.message.text = `/tts ${naturalAction.value}`;
        return this.handleTts(ctx);
      }
      if (naturalAction.type === 'model') {
        ctx.message.text = `/model ${naturalAction.value}`;
        return this.handleModel(ctx);
      }
      if (naturalAction.type === 'persona_set') {
        ctx.message.text = `/persona ${naturalAction.value}`;
        return this.handlePersona(ctx);
      }
      if (naturalAction.type === 'language_set') {
        ctx.message.text = `/language ${naturalAction.value}`;
        return this.handleLanguage(ctx);
      }
    }

    const shouldRespond = shouldRespondToMessage({
      chatType: ctx.chat.type,
      text,
      caption,
      isReplyToBot: ctx.message.reply_to_message?.from?.username === this.botUsername,
      botUsername: this.botUsername,
      triggerMode: chat?.triggerMode || this.config.groupTriggerMode,
      keyword: chat?.keyword || this.config.groupTriggerKeyword
    });

    if (!shouldRespond) return;

    if (!this.isAllowed(ctx)) {
      await ctx.reply(this.t(locale, 'noAccess'));
      return;
    }

    if (!this.checkRateLimit(ctx.from.id)) {
      await ctx.reply(this.t(locale, 'rateLimited'));
      return;
    }

    const quota = this.db.consumeDailyQuota(ctx.from.id, this.config.dailyQuota);
    await this.db.write();
    if (!quota.allowed) {
      await ctx.reply(this.t(locale, 'quotaExceeded'));
      return;
    }

    try {
      await ctx.sendChatAction('typing');
      const prepared = await this.prepareUserMessage(ctx);
      const model = user?.preferredModel || chat?.defaultModel || this.config.defaultModel;
      const sessionId = createSessionId(ctx);
      const history = buildConversationHistory(this.db.getConversation(sessionId), this.config.maxHistoryMessages);
      const systemMessage = {
        role: 'system',
        content: createSystemPrompt(this.config, chat || {}, user || { persona: 'default', customSystemPrompt: '' }, locale)
      };

      const messages = [systemMessage, ...history, prepared.message];
      const result = await this.aiClient.completeWithTools({
        model,
        messages,
        tools:
          this.config.enableToolCalls && this.getProviderCapabilities().toolCalls
            ? this.toolRegistry.getDefinitions()
            : [],
        toolRunner: async (toolCall) => {
          const output = await this.toolRegistry.execute(toolCall);
          await this.db.incrementStats('toolCalls');
          return output;
        }
      });

      await this.db.incrementStats('messagesHandled');
      await this.db.incrementStats('aiCalls');
      await this.db.setConversation(
        sessionId,
        buildConversationHistory(
          result.messages.filter((item) => item.role !== 'system'),
          this.config.maxHistoryMessages
        )
      );

      await sendTextReply(ctx, result.text || this.t(locale, 'noReply'), this.config.maxOutputChars);
    } catch (error) {
      this.logger.error('Failed to handle message', error);
      await ctx.reply(this.t(locale, 'messageFailed', { error: error.message }));
    }
  }

  async prepareUserMessage(ctx) {
    const locale = this.getLocale(ctx);
    const text = truncateText(ctx.message.text || ctx.message.caption || '', this.config.maxInputChars);
    const urls = extractUrls(text);
    let decoratedText = text;
    if (urls.length > 0) {
      decoratedText = `${decoratedText}\n\nDetected URLs:\n${urls.join('\n')}`.trim();
    }

    if (ctx.message.photo?.length) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await readTelegramFile(ctx, photo.file_id, 'image.jpg', 'image/jpeg');
      return {
        message: {
          role: 'user',
          content: [
            { type: 'text', text: decoratedText || (locale === 'en' ? 'Please analyze this image.' : '请分析这张图片。') },
            { type: 'image_url', image_url: { url: toDataUri(file.buffer, file.mimeType) } }
          ]
        }
      };
    }

    if (ctx.message.voice || ctx.message.audio) {
      if (!this.getProviderCapabilities().speechTranscription) {
        return {
          message: {
            role: 'user',
            content: [
              decoratedText,
              this.t(locale, 'noTranscriptionSupport')
            ]
              .filter(Boolean)
              .join('\n\n')
          }
        };
      }

      const voice = ctx.message.voice || ctx.message.audio;
      const file = await readTelegramFile(
        ctx,
        voice.file_id,
        voice.file_name || 'audio.ogg',
        voice.mime_type || 'audio/ogg'
      );
      const transcript = await this.aiClient.transcribeAudio({
        buffer: file.buffer,
        filename: file.filename,
        mimeType: file.mimeType,
        prompt: 'Transcribe the user audio accurately.'
      });
      await this.db.incrementStats('voiceTranscriptions');
      const prompt = [decoratedText, `Voice transcript:\n${transcript}`].filter(Boolean).join('\n\n');
      return {
        message: {
          role: 'user',
          content: prompt || transcript
        }
      };
    }

    if (ctx.message.document) {
      const document = ctx.message.document;
      if (!SUPPORTED_TEXT_FILE_TYPES.has(document.mime_type)) {
        return {
          message: {
            role: 'user',
            content: `${decoratedText}\n\n${this.t(locale, 'unsupportedDocument', {
              filename: document.file_name || 'document',
              mimeType: document.mime_type
            })}`.trim()
          }
        };
      }

      const file = await readTelegramFile(
        ctx,
        document.file_id,
        document.file_name || 'document.txt',
        document.mime_type || 'text/plain'
      );
      const extracted = truncateText(file.buffer.toString('utf8'), this.config.maxInputChars);
      return {
        message: {
          role: 'user',
          content: [decoratedText, `Attached file: ${file.filename}\n\n${extracted}`].filter(Boolean).join('\n\n')
        }
      };
    }

    return {
      message: {
        role: 'user',
        content: decoratedText || this.t(locale, 'continuePrompt')
      }
    };
  }

  async launch() {
    await this.bot.launch();
    this.logger.info('Telegram bot started');
  }

  async stop(reason) {
    this.logger.info(`Stopping Telegram bot: ${reason}`);
    await this.bot.stop(reason);
  }
}
