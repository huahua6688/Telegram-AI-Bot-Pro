import { Markup, Telegraf } from 'telegraf';
import { randomUUID } from 'node:crypto';
import { buildConversationHistory } from '../utils/conversation.js';
import {
  extractCommandArgs,
  normalizeCommand,
  normalizeLanguageCode,
  shouldRespondToMessage
} from '../utils/telegram.js';
import { extractUrls, splitMessage, truncateText } from '../utils/text.js';
import { personaPresets } from '../config.js';
import { DocumentParser } from './document-parser.js';
import { MultimodalActionService } from './multimodal-action-service.js';
import { AudioOrchestrator } from './audio-orchestrator.js';
import { MemoryManager } from './memory-manager.js';

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
    featureReset: '- 清空记忆：使用按钮或发送“清空记忆”',
    featureModels: '- 模型列表：使用按钮查看可用模型',
    featureModel: '- 切换模型：在回复操作条点“🧠 模型”',
    featurePersona: '- 人格切换：在“⋯ 更多”中切换',
    featureLanguage: '- 语言切换：在“⋯ 更多”中切换',
    featureButtons: '- 可直接点击下方按钮，也支持自然语言如“搜索 xxx”“生成图片 xxx”',
    featureWeb: '- 联网搜索：发送“搜索 xxx”',
    featureImage: '- 图片能力：发送“生成图片 xxx”或“图片编辑 xxx”（需附图）',
    featureTts: '- 语音朗读：发送“朗读 xxx”',
    featurePhoto: '- 直接发送图片：自动识别图片内容',
    featureVoice: '- 直接发送语音：自动转文字并继续对话',
    featureDocument: '- 发送文本文件：自动读取并总结',
    featureChatmode: '- /chatmode [smart|all|mention|reply|keyword]：群聊触发模式',
    featureKeyword: '- /keyword [text]：设置群聊关键词',
    featureStats: '- /stats：查看统计信息',
    featureAdmin: '- 管理员：/block /unblock /allow /disallow [userId]',
    start: '你好，我已经准备好了。你可以直接发消息，也可以点按钮使用常用功能。',
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
    imageEditNeedPhoto: '图片编辑需要你同时发送一张图片，并附上编辑要求。',
    imageEditUnsupported: '当前提供商 {provider} 不支持图片编辑。请切换到支持图片编辑的平台。',
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
    noVisionSupport:
      '用户发送了图片，但当前模型提供商不支持图片理解。请提醒用户改发文字描述，或切换到支持图片理解的平台。',
    unsupportedDocument:
      '用户上传了一个名为 {filename}、类型为 {mimeType} 的文件。请说明当前仅支持直接总结文本类文件。',
    documentTooLarge: '文件 {filename} 过大，当前超出可处理上限，请拆分后重试。',
    documentParseFailed: '文件 {filename} 解析失败：{error}',
    continuePrompt: '请继续。',
    menu: '常用功能按钮已显示在下方。',
    currentLanguage: '当前语言：{language}',
    languageUsage: '用法：/language zh 或 /language en',
    languageUnsupported: '暂不支持该语言。可选：zh, en',
    languageSet: '已切换语言：{language}',
    languagePrompt: '请选择机器人界面语言：',
    modelsPrompt: '请选择模型：',
    personaPrompt: '请选择人格：',
    buttonChat: '💬 对话',
    buttonTranslate: '🌍 翻译',
    buttonMemory: '🧠 记忆',
    buttonHelp: '🆘 帮助',
    buttonReset: '🧹 清空',
    buttonModels: '🤖 模型',
    buttonPersona: '🎭 人格',
    buttonWeb: '🌐 联网搜索',
    buttonImage: '🖼️ 图片',
    buttonDocument: '📎 文件',
    buttonTts: '🎤 语音',
    buttonLanguage: '🌍 语言',
    buttonAdmin: '🛠 管理',
    chatHint: '直接发送你想问的内容就行，我会自动判断怎么处理。',
    translateHint: '请直接发送要翻译的内容。我会自动判断源语言并翻译。',
    translationTargetPrompt: '请选择要翻译成哪种语言：',
    translationSendPrompt: '请发送要翻译的内容。',
    clearPrompt: '请选择要清空的内容：',
    clearShortMemory: '清空当前对话上下文',
    clearLongMemory: '清空长期记忆',
    clearAllMemory: '全部清空',
    clearCancel: '取消',
    clearCancelled: '已取消。',
    shortMemoryCleared: '已清空当前对话上下文。',
    allMemoryCleared: '已清空当前对话上下文、长期记忆和话题状态。',
    memoryPrompt: '请选择记忆管理操作：',
    memoryViewCurrent: '查看当前记忆',
    memoryViewTopic: '查看当前话题',
    memoryViewTopics: '查看话题列表',
    memoryClearAction: '清空记忆',
    memoryCancel: '取消',
    streamingPlaceholder: '正在生成回复...',
    actionRegenerate: '🔄 重生成',
    actionModel: '🧠 模型',
    actionTranslate: '🌍 翻译',
    actionFavorite: '❤️ 收藏',
    actionClearContext: '🗑 上下文',
    actionMore: '⋯ 更多',
    actionBack: '⬅️ 返回',
    actionSaved: '已收藏这条回复。',
    actionAlreadySaved: '这条回复已收藏。',
    actionContextCleared: '当前会话上下文已清空。',
    actionWorking: '处理中...',
    actionNoContext: '操作已过期，请重新发送一条消息。',
    adminEntry: '管理员入口：可用 /block /unblock /allow /disallow [userId]'
  },
  en: {
    helpTitle: 'Available features:',
    featureConversation: '- Chat directly in private; groups support @mention, reply, or keyword triggers',
    featureReset: '- Clear memory: use the button or send "clear memory"',
    featureModels: '- Model list: view available models via buttons',
    featureModel: '- Switch model: tap "🧠 Model" on the reply action bar',
    featurePersona: '- Persona switch: open from "⋯ More"',
    featureLanguage: '- Language switch: open from "⋯ More"',
    featureButtons: '- You can tap the buttons below, or use natural requests like "search ..." or "generate an image ..."',
    featureWeb: '- Web search: send "search ..."',
    featureImage: '- Image actions: send "generate image ..." or "edit image ..." with a photo',
    featureTts: '- Text to speech: send "read aloud ..."',
    featurePhoto: '- Send a photo directly: auto image understanding',
    featureVoice: '- Send voice directly: auto transcription and continue chatting',
    featureDocument: '- Send a text file: auto read and summarize',
    featureChatmode: '- /chatmode [smart|all|mention|reply|keyword]: group trigger mode',
    featureKeyword: '- /keyword [text]: set group trigger keyword',
    featureStats: '- /stats: view usage stats',
    featureAdmin: '- Admin: /block /unblock /allow /disallow [userId]',
    start: 'Hi, I am ready. You can chat directly or tap the buttons for common actions.',
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
    imageEditNeedPhoto: 'Image editing requires sending a photo together with your edit prompt.',
    imageEditUnsupported: 'The current provider {provider} does not support image editing. Please switch to a provider that does.',
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
    noVisionSupport:
      'The user sent a photo, but the current provider does not support image understanding. Tell the user to describe the image in text instead or switch providers.',
    unsupportedDocument:
      'The user uploaded a file named {filename} with type {mimeType}. Explain that only text-like files are summarized directly right now.',
    documentTooLarge: 'The file {filename} is too large to parse directly. Ask the user to split it.',
    documentParseFailed: 'Failed to parse file {filename}: {error}',
    continuePrompt: 'Please continue.',
    menu: 'Common action buttons are shown below.',
    currentLanguage: 'Current language: {language}',
    languageUsage: 'Usage: /language zh or /language en',
    languageUnsupported: 'Unsupported language. Options: zh, en',
    languageSet: 'Switched language to: {language}',
    languagePrompt: 'Choose the bot UI language:',
    modelsPrompt: 'Choose a model:',
    personaPrompt: 'Choose a persona:',
    buttonChat: '💬 Chat',
    buttonTranslate: '🌍 Translate',
    buttonMemory: '🧠 Memory',
    buttonHelp: '🆘 Help',
    buttonReset: '🧹 Clear',
    buttonModels: '🤖 Models',
    buttonPersona: '🎭 Persona',
    buttonWeb: '🌐 Web Search',
    buttonImage: '🖼️ Image Understanding',
    buttonTts: '🎤 Voice',
    buttonLanguage: '🌍 Language',
    buttonAdmin: '🛠 Admin',
    chatHint: 'Send me anything directly. I will decide how to handle it.',
    translateHint: 'Send the text you want to translate. I will detect the source language automatically.',
    translationTargetPrompt: 'Choose the target language:',
    translationSendPrompt: 'Send the text you want to translate.',
    clearPrompt: 'Choose what to clear:',
    clearShortMemory: 'Clear current chat context',
    clearLongMemory: 'Clear long-term memory',
    clearAllMemory: 'Clear everything',
    clearCancel: 'Cancel',
    clearCancelled: 'Cancelled.',
    shortMemoryCleared: 'Current chat context cleared.',
    allMemoryCleared: 'Current chat context, long-term memory, and topic state cleared.',
    memoryPrompt: 'Choose a memory action:',
    memoryViewCurrent: 'View current memory',
    memoryViewTopic: 'View current topic',
    memoryViewTopics: 'View topic list',
    memoryClearAction: 'Clear memory',
    memoryCancel: 'Cancel',
    streamingPlaceholder: 'Composing reply...',
    actionRegenerate: '🔄 Regenerate',
    actionModel: '🧠 Model',
    actionTranslate: '🌍 Translate',
    actionFavorite: '❤️ Favorite',
    actionClearContext: '🗑 Context',
    actionMore: '⋯ More',
    actionBack: '⬅️ Back',
    actionSaved: 'Saved this reply to favorites.',
    actionAlreadySaved: 'This reply is already saved.',
    actionContextCleared: 'Current conversation context cleared.',
    actionWorking: 'Working...',
    actionNoContext: 'This action expired. Send a new message first.',
    adminEntry: 'Admin entry: use /block /unblock /allow /disallow [userId]'
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

function cleanBotOutput(text = '') {
  return String(text || '')
    // 去掉代码块围栏
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    // 去掉行内代码反引号
    .replace(/`([^`]+)`/g, '$1')
    // 去掉 Markdown 标题符号
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    // Markdown 加粗/斜体符号
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^\w])\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|[^\w])_([^_\n]+)_/g, '$1$2')
    // 列表统一成普通短横线，避免一堆 *
    .replace(/^\s*[\*\u2022]\s+/gm, '- ')
    // 去掉引用符号
    .replace(/^\s*>\s?/gm, '')
    // 去掉模型偶尔输出的脚注/上标符号
    .replace(/\^+/g, '')
    // 清理过多空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendTextReply(ctx, text, maxLength, extra = {}) {
  const cleaned = cleanBotOutput(text);
  const chunks = splitMessage(cleaned, maxLength);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStreamingFrames(text, minLength) {
  if (!text || text.length < minLength) {
    return [text];
  }

  const frames = [];
  const targetSteps = Math.min(5, Math.max(3, Math.ceil(text.length / 700)));
  const stepSize = Math.max(60, Math.ceil(text.length / targetSteps));

  for (let cursor = stepSize; cursor < text.length; cursor += stepSize) {
    let frameEnd = text.lastIndexOf('\n', cursor);
    if (frameEnd < cursor - Math.floor(stepSize / 2)) {
      frameEnd = text.lastIndexOf(' ', cursor);
    }
    if (frameEnd <= 0) {
      frameEnd = cursor;
    }
    const frame = text.slice(0, frameEnd).trim();
    if (frame && frame !== frames[frames.length - 1]) {
      frames.push(frame);
    }
  }

  if (text !== frames[frames.length - 1]) {
    frames.push(text);
  }
  return frames;
}

export class TelegramAIBot {
  constructor({ config, db, aiClient, toolRegistry, pluginManager, logger, accessControl = null }) {
    this.config = config;
    this.db = db;
    this.aiClient = aiClient;
    this.toolRegistry = toolRegistry;
    this.pluginManager = pluginManager;
    this.logger = logger;
    this.accessControl = accessControl;
    this.rateLimits = new Map();
    this.assistantActionStates = new Map();
    this.assistantActionStatesByMessage = new Map();
    this.pendingMenuActions = new Map();
    this.aiCooldowns = new Map();
    this.bot = new Telegraf(config.botToken);
    this.botUsername = '';
    this.bot.action(/^memory_pick:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleMemoryTargetCallback(ctx)));
    this.bot.action(/^clear_pick:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleClearTargetCallback(ctx)));
    this.bot.action(/^translate_pick:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleTranslateTargetCallback(ctx)));
    this.bot.action(/^file_pick:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleFileActionCallback(ctx)));
    this.bot.action(/^voice_pick:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleVoiceActionCallback(ctx)));
    this.bot.action(/^image_pick:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleImageActionCallback(ctx)));
    this.documentParser = new DocumentParser(config, logger);
    this.multimodalActions = new MultimodalActionService({
      aiClient,
      db,
      logger,
      getProviderCapabilities: () => this.getProviderCapabilities(),
      getProviderName: () => this.getProviderName()
    });
    this.audioOrchestrator = new AudioOrchestrator({
      config,
      aiClient,
      db,
      logger,
      getProviderCapabilities: () => this.getProviderCapabilities(),
      getProviderName: () => this.getProviderName()
    });
    this.memoryManager = new MemoryManager({
      db,
      aiClient,
      config,
      logger
    });
  }


  getPendingMenuKey(ctx) {
    return `${ctx.chat?.id || ''}:${ctx.from?.id || ''}`;
  }

  setPendingMenuAction(ctx, action) {
    this.pendingMenuActions.set(this.getPendingMenuKey(ctx), {
      action,
      createdAt: Date.now()
    });
  }

  normalizePendingAction(pendingAction) {
    if (!pendingAction) return { type: '', targetLanguage: '' };
    if (typeof pendingAction === 'string') {
      return { type: pendingAction, targetLanguage: '' };
    }
    return {
      type: String(pendingAction.type || ''),
      targetLanguage: String(pendingAction.targetLanguage || '')
    };
  }

  takePendingMenuAction(ctx) {
    const key = this.getPendingMenuKey(ctx);
    const state = this.pendingMenuActions.get(key);
    if (!state) return null;
    this.pendingMenuActions.delete(key);

    // 5 分钟过期
    if (Date.now() - state.createdAt > 5 * 60 * 1000) {
      return null;
    }

    return state.action;
  }

  async handlePendingMenuAction(ctx, pendingAction) {
    const text = String(ctx.message?.text || ctx.message?.caption || '').trim();
    const pending = this.normalizePendingAction(pendingAction);

    if (pending.type === 'translate_prompt') {
      const locale = this.getLocale(ctx);
      if (!text) {
        await ctx.reply(this.t(locale, 'translationSendPrompt'));
        return true;
      }
      await this.runTranslation(ctx, text, pending.targetLanguage || 'auto');
      return true;
    }

    if (pending.type === 'web_prompt') {
      const locale = this.getLocale(ctx);
      if (!text) {
        await ctx.reply(this.t(locale, 'webUsage'));
        return true;
      }
      return this.runWebSearch(ctx, text);
    }

    if (pending.type === 'image_prompt' || pending.type === 'image_understand_prompt') {
      if (ctx.message?.photo?.length) {
        return this.handleIncomingMessage(ctx);
      }

      await ctx.reply('请直接发送图片给我识别。', this.createImageActionKeyboard(locale));
      return true;
    }

    if (pending.type === 'image_generate_prompt') {
      const prompt = text;
      if (!prompt) {
        await ctx.reply('请直接发送图片描述，例如：一只赛博朋克风格的猫。', this.createImageActionKeyboard(locale));
        return true;
      }

      await this.runImageGeneration(ctx, prompt, 'generate');
      return true;
    }

    if (pending.type === 'image_edit_prompt') {
      const prompt = text || ctx.message?.caption || '';
      if (!ctx.message?.photo?.length) {
        await ctx.reply('请发送要编辑的图片，并在图片说明里写编辑要求。', this.createImageActionKeyboard(locale));
        return true;
      }

      if (!prompt) {
        await ctx.reply('请在图片说明里写编辑要求，例如：把背景改成夜晚城市。', this.createImageActionKeyboard(locale));
        return true;
      }

      await this.runImageEdit(ctx, prompt);
      return true;
    }

    if (pending.type === 'voice_prompt' || pending.type === 'voice_transcribe_prompt') {
      if (ctx.message?.voice || ctx.message?.audio) {
        await this.runVoiceTranscription(ctx);
        return true;
      }

      await ctx.reply('请直接发送 Telegram 语音消息或音频文件。', this.createVoiceActionKeyboard(locale));
      return true;
    }

    if (pending.type === 'voice_tts_prompt') {
      if (!text) {
        await ctx.reply('请直接发送要朗读的文字。', this.createVoiceActionKeyboard(locale));
        return true;
      }

      await this.runTextToSpeech(ctx, text);
      return true;
    }

    if (pending.type === 'voice_live_prompt') {
      await ctx.reply(
        '🎧 Gemini Live 入口已预留。\n\n当前 Telegram Bot API 里先保留入口，后续会接入 Gemini Live / Native Audio Dialog 的实时语音流程。\n\n现在可以先使用：\n- 🎙 语音转文字\n- 🔊 文字转语音',
        this.createVoiceActionKeyboard(locale)
      );
      return true;
    }


    if (
      pending.type === 'file_summarize_prompt' ||
      pending.type === 'file_keypoints_prompt' ||
      pending.type === 'file_translate_prompt'
    ) {
      if (!ctx.message?.document) {
        await ctx.reply('请直接发送 PDF、DOCX、XLSX、TXT、MD、JSON、CSV 或 XML 文件。', this.createFileActionKeyboard(locale));
        return true;
      }

      const mode =
        pending.type === 'file_keypoints_prompt'
          ? 'keypoints'
          : pending.type === 'file_translate_prompt'
            ? 'translate'
            : 'summarize';

      await this.runDocumentAction(ctx, mode);
      return true;
    }

    return false;
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
      chat: this.t(locale, 'buttonChat'),
      translate: this.t(locale, 'buttonTranslate'),
      memory: this.t(locale, 'buttonMemory'),
      help: this.t(locale, 'buttonHelp'),
      reset: this.t(locale, 'buttonReset'),
      models: this.t(locale, 'buttonModels'),
      persona: this.t(locale, 'buttonPersona'),
      web: this.t(locale, 'buttonWeb'),
      image: this.t(locale, 'buttonImage'),
      document: this.t(locale, 'buttonDocument'),
      tts: this.t(locale, 'buttonTts'),
      language: this.t(locale, 'buttonLanguage'),
      admin: this.t(locale, 'buttonAdmin')
    };
  }




  createMenuKeyboard(locale) {
    const labels = this.getMenuLabels(locale);
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(labels.chat, 'menu:chat'),
        Markup.button.callback(labels.translate, 'menu:translate')
      ],
      [
        Markup.button.callback(labels.memory, 'menu:memory'),
        Markup.button.callback(labels.models, 'menu:models')
      ],
      [
        Markup.button.callback(labels.document, 'menu:file'),
        Markup.button.callback(labels.web, 'menu:web')
      ],
      [
        Markup.button.callback(labels.image, 'menu:image'),
        Markup.button.callback(labels.tts, 'menu:tts')
      ],
      [
        Markup.button.callback(labels.admin, 'menu:admin'),
        Markup.button.callback(labels.language, 'menu:language')
      ],
      [
        Markup.button.callback(labels.reset, 'menu:reset'),
        Markup.button.callback(labels.help, 'menu:help')
      ]
    ]);
  }


  createAdminActionKeyboard(locale = 'zh') {
    const labels =
      locale === 'en'
        ? {
            status: '🤖 Bot status',
            whoami: '👤 My ID',
            models: '🧠 Models',
            quota: '📊 Quota',
            aiTest: '🧪 AI test',
            configCheck: '🧭 Config check',
            version: 'ℹ️ Version',
            docs: '📚 Deploy docs',
            cancel: 'Cancel'
          }
        : {
            status: '🤖 Bot 状态',
            whoami: '👤 我的 ID',
            models: '🧠 模型列表',
            quota: '📊 额度状态',
            aiTest: '🧪 AI 测试',
            configCheck: '🧭 配置检查',
            version: 'ℹ️ 版本信息',
            docs: '📚 部署文档',
            cancel: '取消'
          };

    return Markup.inlineKeyboard([
      [
        Markup.button.callback(labels.status, 'admin_pick:status'),
        Markup.button.callback(labels.whoami, 'admin_pick:whoami')
      ],
      [
        Markup.button.callback(labels.models, 'admin_pick:models'),
        Markup.button.callback(labels.quota, 'admin_pick:quota')
      ],
      [
        Markup.button.callback(labels.aiTest, 'admin_pick:ai_test'),
        Markup.button.callback(labels.configCheck, 'admin_pick:config_check')
      ],
      [
        Markup.button.callback(labels.version, 'admin_pick:version'),
        Markup.button.callback(labels.docs, 'admin_pick:docs')
      ],
      [Markup.button.callback(labels.cancel, 'admin_pick:cancel')],
      [Markup.button.callback(locale === 'en' ? '⬅️ Main menu' : '⬅️ 返回主菜单', 'menu:back')]
    ]);
  }

  createDeployDocsKeyboard(locale = 'zh') {
    const repo = 'https://github.com/huahua6688/Telegram-AI-Bot-Pro/blob/main';

    return Markup.inlineKeyboard([
      [
        Markup.button.url(locale === 'en' ? 'Zeabur' : 'Zeabur 部署', `${repo}/docs/ZEABUR.md`),
        Markup.button.url(locale === 'en' ? 'Env vars' : '环境变量', `${repo}/docs/ENVIRONMENT.md`)
      ],
      [
        Markup.button.url(locale === 'en' ? 'Checklist' : '部署清单', `${repo}/docs/DEPLOY_CHECKLIST.md`),
        Markup.button.url(locale === 'en' ? 'Troubleshooting' : '故障排查', `${repo}/docs/TROUBLESHOOTING.md`)
      ],
      [
        Markup.button.url(locale === 'en' ? 'Commands' : '命令说明', `${repo}/docs/COMMANDS.md`),
        Markup.button.url(locale === 'en' ? 'Security' : '安全说明', `${repo}/SECURITY.md`)
      ],
      [Markup.button.callback(locale === 'en' ? '⬅️ Admin panel' : '⬅️ 返回管理', 'admin_pick:back')]
    ]);
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

  createMemoryPanelKeyboard(locale = 'zh') {
    return Markup.inlineKeyboard([
      [Markup.button.callback(this.t(locale, 'memoryViewCurrent'), 'memory_pick:current')],
      [Markup.button.callback(this.t(locale, 'memoryViewTopic'), 'memory_pick:topic')],
      [Markup.button.callback(this.t(locale, 'memoryViewTopics'), 'memory_pick:topics')],
      [Markup.button.callback(this.t(locale, 'memoryClearAction'), 'memory_pick:clear')],
      [Markup.button.callback(this.t(locale, 'memoryCancel'), 'memory_pick:cancel')]
    ]);
  }

  createClearMemoryKeyboard(locale = 'zh') {
    return Markup.inlineKeyboard([
      [Markup.button.callback(this.t(locale, 'clearShortMemory'), 'clear_pick:short')],
      [Markup.button.callback(this.t(locale, 'clearLongMemory'), 'clear_pick:long')],
      [Markup.button.callback(this.t(locale, 'clearAllMemory'), 'clear_pick:all')],
      [Markup.button.callback(this.t(locale, 'clearCancel'), 'clear_pick:cancel')]
    ]);
  }


  createVoiceActionKeyboard(locale = 'zh') {
    const labels =
      locale === 'en'
        ? {
            transcribe: '🎙 Voice to text',
            tts: '🔊 Text to speech',
            live: '🎧 Gemini Live',
            cancel: 'Cancel'
          }
        : {
            transcribe: '🎙 语音转文字',
            tts: '🔊 文字转语音',
            live: '🎧 Gemini Live',
            cancel: '取消'
          };

    return Markup.inlineKeyboard([
      [
        Markup.button.callback(labels.transcribe, 'voice_pick:transcribe'),
        Markup.button.callback(labels.tts, 'voice_pick:tts')
      ],
      [Markup.button.callback(labels.live, 'voice_pick:live')],
      [Markup.button.callback(labels.cancel, 'voice_pick:cancel')],
      [Markup.button.callback(locale === 'en' ? '⬅️ Main menu' : '⬅️ 返回主菜单', 'menu:back')]
    ]);
  }


  createFileActionKeyboard(locale = 'zh') {
    const labels =
      locale === 'en'
        ? {
            summarize: '📄 Summarize file',
            keypoints: '🎯 Extract key points',
            translate: '🌍 Translate file',
            cancel: 'Cancel'
          }
        : {
            summarize: '📄 总结文件',
            keypoints: '🎯 提取重点',
            translate: '🌍 翻译文件',
            cancel: '取消'
          };

    return Markup.inlineKeyboard([
      [Markup.button.callback(labels.summarize, 'file_pick:summarize')],
      [Markup.button.callback(labels.keypoints, 'file_pick:keypoints')],
      [Markup.button.callback(labels.translate, 'file_pick:translate')],
      [Markup.button.callback(labels.cancel, 'file_pick:cancel')],
      [Markup.button.callback(locale === 'en' ? '⬅️ Main menu' : '⬅️ 返回主菜单', 'menu:back')]
    ]);
  }

  createTranslationTargetKeyboard(locale = 'zh') {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('中文', 'translate_pick:zh'),
        Markup.button.callback('English', 'translate_pick:en')
      ],
      [
        Markup.button.callback('高棉语', 'translate_pick:km'),
        Markup.button.callback('粤语', 'translate_pick:yue')
      ],
      [
        Markup.button.callback('繁体中文', 'translate_pick:zh_hant'),
        Markup.button.callback(locale === 'en' ? 'Auto' : '自动判断', 'translate_pick:auto')
      ]
    ]);
  }


  createImageActionKeyboard(locale = 'zh') {
    const labels =
      locale === 'en'
        ? {
            understand: '🔍 Understand image',
            generate: '🎨 Generate image',
            edit: '🛠 Edit image',
            cancel: 'Cancel'
          }
        : {
            understand: '🔍 图片识别',
            generate: '🎨 生成图片',
            edit: '🛠 编辑图片',
            cancel: '取消'
          };

    return Markup.inlineKeyboard([
      [
        Markup.button.callback(labels.understand, 'image_pick:understand'),
        Markup.button.callback(labels.generate, 'image_pick:generate')
      ],
      [Markup.button.callback(labels.edit, 'image_pick:edit')],
      [Markup.button.callback(labels.cancel, 'image_pick:cancel')],
      [Markup.button.callback(locale === 'en' ? '⬅️ Main menu' : '⬅️ 返回主菜单', 'menu:back')]
    ]);
  }

  resolveTranslationTargetCode(code = '') {
    const normalized = String(code || '').trim().toLowerCase();

    const targets = {
      auto: 'auto',
      zh: 'Simplified Chinese',
      cn: 'Simplified Chinese',
      en: 'English',
      km: 'Khmer',
      khmer: 'Khmer',
      yue: 'Cantonese (Hong Kong)',
      cantonese: 'Cantonese (Hong Kong)',
      zh_hant: 'Traditional Chinese',
      traditional: 'Traditional Chinese'
    };

    return targets[normalized] || 'auto';
  }

  createAssistantActionKeyboard(locale, token) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(this.t(locale, 'actionRegenerate'), `act:regen:${token}`),
        Markup.button.callback(this.t(locale, 'actionModel'), `act:model:${token}`),
        Markup.button.callback(this.t(locale, 'actionTranslate'), `act:translate:${token}`)
      ],
      [
        Markup.button.callback(this.t(locale, 'actionFavorite'), `act:favorite:${token}`),
        Markup.button.callback(this.t(locale, 'actionClearContext'), `act:clear:${token}`),
        Markup.button.callback(this.t(locale, 'actionMore'), `act:more:${token}`)
      ]
    ]);
  }

  createAssistantMoreKeyboard(locale, token) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(this.t(locale, 'buttonPersona'), `act:persona:${token}`),
        Markup.button.callback(this.t(locale, 'buttonLanguage'), `act:language:${token}`)
      ],
      [Markup.button.callback(this.t(locale, 'actionBack'), `act:back:${token}`)]
    ]);
  }

  createAssistantTranslationKeyboard(locale, token) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('中文', `act:translate_pick:${token}:zh`),
        Markup.button.callback('English', `act:translate_pick:${token}:en`)
      ],
      [
        Markup.button.callback('高棉语', `act:translate_pick:${token}:km`),
        Markup.button.callback('粤语', `act:translate_pick:${token}:yue`)
      ],
      [
        Markup.button.callback('繁体中文', `act:translate_pick:${token}:zh_hant`),
        Markup.button.callback(locale === 'en' ? 'Auto' : '自动', `act:translate_pick:${token}:auto`)
      ],
      [Markup.button.callback(this.t(locale, 'actionBack'), `act:back:${token}`)]
    ]);
  }

  createAssistantModelKeyboard(locale, token, currentModel = '') {
    const modelButtons = this.config.availableModels.map((model, index) =>
      Markup.button.callback(model === currentModel ? `✅ ${model}` : model, `act:model_pick:${token}:${index}`)
    );
    return Markup.inlineKeyboard([
      ...chunkItems(modelButtons, 2),
      [Markup.button.callback(this.t(locale, 'actionBack'), `act:back:${token}`)]
    ]);
  }

  createAssistantPersonaKeyboard(locale, token, currentPersona = 'default') {
    const buttons = Object.keys(personaPresets).map((persona) =>
      Markup.button.callback(
        persona === currentPersona ? `✅ ${persona}` : persona,
        `act:persona_pick:${token}:${persona}`
      )
    );
    return Markup.inlineKeyboard([
      ...chunkItems(buttons, 2),
      [Markup.button.callback(this.t(locale, 'actionBack'), `act:back:${token}`)]
    ]);
  }

  createAssistantLanguageKeyboard(locale, token, currentLanguage = 'zh') {
    const buttons = Object.entries(LANGUAGE_NAMES).map(([code, name]) =>
      Markup.button.callback(code === currentLanguage ? `✅ ${name}` : name, `act:language_pick:${token}:${code}`)
    );
    return Markup.inlineKeyboard([
      ...chunkItems(buttons, 2),
      [Markup.button.callback(this.t(locale, 'actionBack'), `act:back:${token}`)]
    ]);
  }

  parseNaturalLanguageAction(text = '', locale = 'zh') {
    const content = text.trim();
    if (!content) return null;

    const menuLabels = this.getMenuLabels(locale);
    const buttonMap = new Map([
      [menuLabels.chat, { type: 'chat_hint' }],
      [menuLabels.translate, { type: 'translate_prompt' }],
      [menuLabels.memory, { type: 'memory_prompt' }],
      [menuLabels.help, { type: 'help' }],
      [menuLabels.reset, { type: 'reset' }],
      [menuLabels.models, { type: 'models' }],
      [menuLabels.persona, { type: 'persona' }],
      [menuLabels.web, { type: 'web_prompt' }],
      [menuLabels.image, { type: 'image_menu' }],
      [menuLabels.document, { type: 'file_menu' }],
      [menuLabels.tts, { type: 'voice_menu' }],
      [menuLabels.language, { type: 'language' }],
      [menuLabels.admin, { type: 'admin_menu' }]
    ]);
    if (buttonMap.has(content)) {
      return buttonMap.get(content);
    }

    if (/^(help|帮助|幫助)$/i.test(content)) return { type: 'help' };
    if (/^(main menu|menu|主菜单|主選單|菜单|選單)$/i.test(content)) return { type: 'main_menu' };
    if (/^(reset|clear|清空|重置)(对话|對話|会话|會話|记忆|記憶)?$/i.test(content)) return { type: 'reset' };
    if (/^(models?|模型(列表)?)$/i.test(content)) return { type: 'models' };
    if (/^(persona|人格)$/i.test(content)) return { type: 'persona' };
    if (/^(language|语言|語言)$/i.test(content)) return { type: 'language' };
    if (/^(admin|管理|管理员|管理面板|后台)$/i.test(content)) return { type: 'admin_menu' };
    if (/^(files?|documents?|文档|文件|文件处理|文档处理)$/i.test(content)) return { type: 'file_menu' };

    if (/^(查看|显示|顯示|show)?(长期|長期)?记忆$/i.test(content) || /^(memory|mem)$/i.test(content)) {
      return { type: 'memory_show' };
    }
    if (/^(查看|显示|顯示|show)?(当前|當前)?话题$/i.test(content) || /^(topic|current topic)$/i.test(content)) {
      return { type: 'topic_show' };
    }
    if (/^(查看|显示|顯示|show)?话题列表$/i.test(content) || /^(topics)$/i.test(content)) {
      return { type: 'topics_show' };
    }
    if (/^(清空|删除|刪除|clear|delete)(长期|長期)?记忆$/i.test(content) || /^(clear memory|delete memory)$/i.test(content)) {
      return { type: 'memory_clear' };
    }
    if (/^(清空|删除|刪除|clear|delete)话题状态$/i.test(content) || /^(clear topics)$/i.test(content)) {
      return { type: 'topics_clear' };
    }

    const actionPatterns = [
      { type: 'web', regex: /^(?:web|search|搜索|联网搜索|上网搜)\s+(.+)$/i },
      { type: 'image', regex: /^(?:image|draw|paint|生成图片|生成圖像|画|畫)\s+(.+)$/i },
      { type: 'image_edit', regex: /^(?:edit image|图片编辑|圖片編輯|改图|改圖)\s+(.+)$/i },
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


  normalizeTranslationTarget(value = '') {
    const raw = String(value || '').trim();
    const normalized = raw
      .toLowerCase()
      .replace(/[()（）]/g, '')
      .replace(/\s+/g, '');

    if (!normalized) return 'auto';

    const aliases = new Map([
      ['中文', 'Simplified Chinese'],
      ['简体中文', 'Simplified Chinese'],
      ['簡體中文', 'Simplified Chinese'],
      ['汉语', 'Simplified Chinese'],
      ['漢語', 'Simplified Chinese'],
      ['普通话', 'Simplified Chinese'],
      ['普通話', 'Simplified Chinese'],
      ['chinese', 'Simplified Chinese'],
      ['mandarin', 'Simplified Chinese'],
      ['zh', 'Simplified Chinese'],
      ['zhcn', 'Simplified Chinese'],

      ['繁体', 'Traditional Chinese'],
      ['繁體', 'Traditional Chinese'],
      ['繁体中文', 'Traditional Chinese'],
      ['繁體中文', 'Traditional Chinese'],
      ['traditionalchinese', 'Traditional Chinese'],
      ['zhtw', 'Traditional Chinese'],
      ['zhhk', 'Traditional Chinese'],

      ['英文', 'English'],
      ['英语', 'English'],
      ['英語', 'English'],
      ['english', 'English'],
      ['en', 'English'],

      ['粤语', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['粵語', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['广东话', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['廣東話', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['香港粤语', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['香港粵語', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['香港广东话', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['香港廣東話', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['粤语香港', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['粵語香港', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['cantonese', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['hongkongcantonese', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],
      ['yue', 'Hong Kong Cantonese written in natural Traditional Chinese Cantonese characters'],

      ['高棉语', 'Khmer'],
      ['高棉語', 'Khmer'],
      ['柬埔寨语', 'Khmer'],
      ['柬埔寨語', 'Khmer'],
      ['柬语', 'Khmer'],
      ['柬語', 'Khmer'],
      ['khmer', 'Khmer'],
      ['km', 'Khmer'],

      ['日语', 'Japanese'],
      ['日語', 'Japanese'],
      ['日本语', 'Japanese'],
      ['日本語', 'Japanese'],
      ['japanese', 'Japanese'],
      ['ja', 'Japanese'],

      ['韩语', 'Korean'],
      ['韓語', 'Korean'],
      ['韩国语', 'Korean'],
      ['韓國語', 'Korean'],
      ['korean', 'Korean'],
      ['ko', 'Korean'],

      ['泰语', 'Thai'],
      ['泰語', 'Thai'],
      ['thai', 'Thai'],
      ['th', 'Thai'],

      ['马来语', 'Malay'],
      ['馬來語', 'Malay'],
      ['malay', 'Malay'],
      ['ms', 'Malay'],

      ['越南语', 'Vietnamese'],
      ['越南語', 'Vietnamese'],
      ['vietnamese', 'Vietnamese'],

      ['法语', 'French'],
      ['法語', 'French'],
      ['french', 'French'],

      ['西班牙语', 'Spanish'],
      ['西班牙語', 'Spanish'],
      ['spanish', 'Spanish'],

      ['阿拉伯语', 'Arabic'],
      ['阿拉伯語', 'Arabic'],
      ['arabic', 'Arabic'],

      ['印地语', 'Hindi'],
      ['印地語', 'Hindi'],
      ['hindi', 'Hindi']
    ]);

    return aliases.get(normalized) || raw;
  }

  splitTranslationTargetAndBody(input = '') {
    const value = String(input || '').trim();
    if (!value) return null;

    const colonIndex = Math.max(value.indexOf(':'), value.indexOf('：'));
    if (colonIndex > 0) {
      const target = value.slice(0, colonIndex).trim();
      const body = value.slice(colonIndex + 1).trim();
      if (target && body) return { target, body };
    }

    let depth = 0;
    for (let index = 0; index < value.length; index += 1) {
      const ch = value[index];
      if (ch === '(' || ch === '（') depth += 1;
      if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);

      if (depth === 0 && /\s/.test(ch)) {
        const target = value.slice(0, index).trim();
        const body = value.slice(index + 1).trim();
        if (target && body) return { target, body };
      }
    }

    return null;
  }

  parseTranslationRequest(text = '') {
    const content = String(text || '').trim();
    if (!content) return null;

    let match = content.match(/^(?:中译英|中譯英|中文翻英文|中文翻译成英文|中文翻譯成英文)\s*[:：]?\s*([\s\S]+)$/i);
    if (match) return { text: match[1].trim(), targetLanguage: 'English' };

    match = content.match(/^(?:英译中|英譯中|英文翻中文|英文翻译成中文|英文翻譯成中文)\s*[:：]?\s*([\s\S]+)$/i);
    if (match) return { text: match[1].trim(), targetLanguage: 'Simplified Chinese' };

    match = content.match(/^(?:粤译中|粵譯中|粤语翻中文|粵語翻中文|广东话翻中文|廣東話翻中文)\s*[:：]?\s*([\s\S]+)$/i);
    if (match) return { text: match[1].trim(), targetLanguage: 'Simplified Chinese' };

    match = content.match(/^(?:简译繁|簡譯繁|简体转繁体|簡體轉繁體)\s*[:：]?\s*([\s\S]+)$/i);
    if (match) return { text: match[1].trim(), targetLanguage: 'Traditional Chinese' };

    match = content.match(/^(?:繁译简|繁譯簡|繁体转简体|繁體轉簡體)\s*[:：]?\s*([\s\S]+)$/i);
    if (match) return { text: match[1].trim(), targetLanguage: 'Simplified Chinese' };

    const leadingPrefixes = ['翻译成', '翻譯成', '翻译为', '翻譯為', '译成', '譯成', '翻成'];
    for (const prefix of leadingPrefixes) {
      if (content.startsWith(prefix)) {
        const parsed = this.splitTranslationTargetAndBody(content.slice(prefix.length));
        if (parsed) {
          return {
            targetLanguage: this.normalizeTranslationTarget(parsed.target),
            text: parsed.body
          };
        }
      }
    }

    const reverseMarkers = ['翻译成', '翻譯成', '翻译为', '翻譯為', '译成', '譯成', '翻成'];
    for (const marker of reverseMarkers) {
      const index = content.lastIndexOf(marker);
      if (index > 0) {
        let body = content.slice(0, index).trim();
        let target = content.slice(index + marker.length).trim();

        body = body.replace(/^(?:把|将|將)\s*/, '').replace(/^["“]/, '').replace(/["”]$/, '').trim();
        target = target.replace(/^[:：]/, '').trim();

        if (body && target) {
          return {
            targetLanguage: this.normalizeTranslationTarget(target),
            text: body
          };
        }
      }
    }

    match = content.match(/^(?:translate|tr)\s+(?:to|into)\s+([^:：]+)\s*[:：]\s*([\s\S]+)$/i);
    if (match) {
      return {
        targetLanguage: this.normalizeTranslationTarget(match[1]),
        text: match[2].trim()
      };
    }

    match = content.match(/^(?:翻译|翻譯|translate|tr)\s*[:：]?\s*([\s\S]+)$/i);
    if (match) {
      return {
        targetLanguage: 'auto',
        text: match[1].trim()
      };
    }

    return null;
  }

  async runTranslation(ctx, text = '', targetLanguage = 'auto') {
    const locale = this.getLocale(ctx);
    const sourceText = String(text || '').trim();

    if (!sourceText) {
      await ctx.reply('请输入要翻译的内容，例如：\n翻译成粤语（香港） 你今天吃饭了吗？\n把 I miss you 翻译成中文\n翻译成高棉语 我很担心你');
      return;
    }

    const targetInstruction =
      targetLanguage === 'auto'
        ? 'Detect the source language. If the source text is Chinese, translate it into natural English. Otherwise translate it into natural Simplified Chinese.'
        : `Translate the source text into ${targetLanguage}.`;

    const model = this.config.translationModel || this.config.defaultModel;

    try {
      await ctx.sendChatAction('typing');

      const completion = await this.completeWithAiFallback({
        scope: 'translation',
        model,
        locale: this.getLocale(ctx),
        request: {
          messages: [
          {
            role: 'system',
            content: [
              'You are a professional translation engine.',
              'Translate accurately and naturally.',
              'Strictly follow the requested target language.',
              'Detect the source language automatically.',
              'If the target is Hong Kong Cantonese, use natural Hong Kong Cantonese wording and Traditional Chinese characters, such as 咗、嘅、唔、冇、佢、喺 when appropriate.',
              'Preserve meaning, tone, names, numbers, emojis, and line breaks.',
              'Do not add explanations unless the user explicitly asks.',
              'Output only the translation.'
            ].join('\n')
          },
          {
            role: 'user',
            content: `${targetInstruction}\n\nSource text:\n${sourceText}`
          }
        ],
          tools: [],
          temperature: 0.1
        }
      });

      const result = completion.result;
      await sendTextReply(ctx, result.text || this.t(locale, 'noReply'), this.config.maxOutputChars);
    } catch (error) {
      if (this.isAiQuotaError(error)) {
        this.setAiCooldown('translation', model, error);
      }

      this.logger.error('Translation failed', { error: this.formatLogError(error) });
      await ctx.reply(this.formatUserFacingError(error, locale));
    }
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
        vision: true,
        imageGeneration: true,
        imageEditing: false,
        speechSynthesis: true,
        speechTranscription: true,
        liveAudio: false,
        liveTranslate: false
      }
    );
  }

  extractJsonObject(text = '') {
    const raw = String(text || '').trim();
    if (!raw) return null;

    try {
      return JSON.parse(raw);
    } catch {
      // continue
    }

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  shouldUseAiRouter(text = '') {
    if (!this.config.enableAiRouter) return false;

    const mode = String(this.config.aiRouterMode || 'smart').toLowerCase();
    if (mode === 'always') return true;
    if (mode === 'off' || mode === 'false') return false;

    const content = String(text || '').trim();
    if (!content) return false;

    return /(?:继续|接着|刚才|剛才|上一步|下一步|下一步是什么|翻译|翻譯|怎么说|怎麼說|translate|搜索|搜一下|联网|聯網|最新|今天|现在|現在|汇率|匯率|天气|天氣|新闻|新聞|模型|model|帮助|help|清空|删除|刪除|记忆|記憶|话题|話題)/i.test(content);
  }

  async classifyUserIntent(ctx, text = '', memoryContext = null) {
    if (!this.config.enableAiRouter) return { intent: 'chat' };

    const content = String(text || '').trim();
    if (!content) return { intent: 'chat' };

    const model = this.config.routerModel || this.config.translationModel || this.config.defaultModel;

    try {
      const completion = await this.completeWithAiFallback({
        scope: 'router',
        model,
        locale: this.getLocale(ctx),
        request: {
          messages: [
          {
            role: 'system',
            content: [
              'You are an intent and topic router for a Telegram AI bot.',
              'Return only valid JSON. Do not use Markdown. Do not explain.',
              '',
              'Allowed intents:',
              '- chat: normal conversation or normal question',
              '- translate: translation, rewrite into another language, or asks how to say something in another language',
              '- web_search: latest/current information, news, prices, exchange rates, weather, schedules, or explicit search request',
              '- reset_memory: clear/reset/delete conversation memory',
              '- help: asks what the bot can do or how to use it',
              '- models: asks to view/change/switch AI model',
              '',
              'Known topics:',
              '- telegram_bot: Telegram AI bot, Zeabur, Gemini, Dockerfile, buttons, translation, AI router, memory',
              '- proxy_node: proxy node, x-ui, 3x-ui, v2ray, xray, server panel',
              '- network_router: router, SIM card, DNS, Wi-Fi, TP-Link MR505, U Mobile, CelcomDigi',
              '- travel_malaysia: Malaysia travel/life, RM, Kuala Lumpur, AirAsia',
              '- translation_chat: language translation, Khmer, Cantonese, Traditional Chinese',
              '- general: anything else',
              '',
              'JSON schema:',
              '{',
              '  "intent": "chat|translate|web_search|reset_memory|help|models",',
              '  "topicId": "telegram_bot|proxy_node|network_router|travel_malaysia|translation_chat|general",',
              '  "isSideQuestion": true,',
              '  "returnTopicId": "previous main topic id or empty",',
              '  "text": "text to translate or chat text",',
              '  "targetLanguage": "target language for translate, empty if not translate",',
              '  "query": "search query for web_search, empty if not web_search"',
              '}',
              '',
              'Rules:',
              '1. If the user says continue, next step, go on, or 继续刚才那个, use the current main topic from memory.',
              '2. If the user temporarily asks about a different topic, set isSideQuestion=true and returnTopicId to the previous main topic.',
              '3. If the user asks translate to X, change to X, rewrite as X, X怎么说, or how to say in X, use translate.',
              '4. For translate, extract source text into text and target language into targetLanguage.',
              '5. If unsure, use chat and general.',
              '6. Output JSON only.'
            ].join('\n')
          },
          {
            role: 'user',
            content: [
              memoryContext?.text ? `Memory context:\n${memoryContext.text}` : '',
              '',
              `User message:\n${content}`
            ].join('\n').trim()
          }
        ],
          tools: [],
          temperature: 0
        }
      });

      const result = completion.result;
      const parsed = this.extractJsonObject(result.text || '');
      if (!parsed || typeof parsed !== 'object') return { intent: 'chat' };

      const allowedIntents = new Set(['chat', 'translate', 'web_search', 'reset_memory', 'help', 'models']);
      const allowedTopics = new Set(['telegram_bot', 'proxy_node', 'network_router', 'travel_malaysia', 'translation_chat', 'general']);

      const intent = allowedIntents.has(String(parsed.intent || '').trim()) ? String(parsed.intent).trim() : 'chat';
      const topicId = allowedTopics.has(String(parsed.topicId || '').trim()) ? String(parsed.topicId).trim() : memoryContext?.topicId || 'general';

      return {
        intent,
        topicId,
        isSideQuestion: Boolean(parsed.isSideQuestion),
        returnTopicId: String(parsed.returnTopicId || '').trim(),
        text: String(parsed.text || content).trim(),
        targetLanguage: String(parsed.targetLanguage || '').trim(),
        query: String(parsed.query || '').trim()
      };
    } catch (error) {
      if (this.isAiQuotaError(error)) {
        this.setAiCooldown('router', model, error);
      }

      this.logger.warn('AI router failed, fallback to chat', { error: this.formatLogError(error) });
      return { intent: 'chat', topicId: memoryContext?.topicId || 'general' };
    }
  }

  async handleRoutedIntent(ctx, routedIntent, locale) {
    const intent = String(routedIntent?.intent || 'chat');

    if (intent === 'translate') {
      const sourceText = String(routedIntent.text || '').trim();
      const targetLanguage = this.normalizeTranslationTarget(routedIntent.targetLanguage || 'auto');

      if (sourceText) {
        await this.runTranslation(ctx, sourceText, targetLanguage || 'auto');
        return true;
      }

      return false;
    }

    if (intent === 'web_search') {
      const query = String(routedIntent.query || routedIntent.text || '').trim();
      if (query) {
        await this.runWebSearch(ctx, query);
        return true;
      }
      return false;
    }

    if (intent === 'reset_memory') {
      await this.handleReset(ctx);
      return true;
    }

    if (intent === 'help') {
      await this.handleHelp(ctx);
      return true;
    }

    if (intent === 'models') {
      await this.handleModels(ctx);
      return true;
    }

    return false;
  }

  extractRetrySecondsFromError(error) {
    const raw = String(error?.message || error || '');
    const retryMatch = raw.match(/retry in\s+([\d.]+)s/i);
    if (!retryMatch) return 0;
    return Math.max(0, Math.ceil(Number(retryMatch[1]) || 0));
  }

  isAiQuotaError(error) {
    const raw = String(error?.message || error || '').toLowerCase();
    return (
      raw.includes('429') ||
      raw.includes('resource_exhausted') ||
      raw.includes('quota') ||
      raw.includes('rate limit') ||
      raw.includes('rate-limit') ||
      raw.includes('generate_content_free_tier_requests')
    );
  }

  getAiCooldownKey(scope = 'ai', model = '') {
    return `${String(scope || 'ai')}:${String(model || this.config.defaultModel || 'default')}`;
  }

  getAiCooldown(scope = 'ai', model = '') {
    const key = this.getAiCooldownKey(scope, model);
    const expiresAt = this.aiCooldowns.get(key) || 0;

    if (!expiresAt) return null;

    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.aiCooldowns.delete(key);
      return null;
    }

    return {
      key,
      scope,
      model,
      retrySeconds: Math.ceil(remainingMs / 1000)
    };
  }

  setAiCooldown(scope = 'ai', model = '', error = null) {
    const retrySeconds = this.extractRetrySecondsFromError(error) || 60;
    const safeSeconds = Math.max(10, Math.min(retrySeconds, 300));
    const key = this.getAiCooldownKey(scope, model);

    this.aiCooldowns.set(key, Date.now() + safeSeconds * 1000);

    return {
      key,
      scope,
      model,
      retrySeconds: safeSeconds
    };
  }

  formatQuotaCooldownMessage(cooldown, locale = 'zh') {
    const retrySeconds = Math.max(1, Number(cooldown?.retrySeconds || 0));

    if (locale === 'en') {
      return `AI quota is cooling down. Please try again in about ${retrySeconds} seconds.`;
    }

    return `AI 额度正在冷却中，请大约 ${retrySeconds} 秒后再试。`;
  }

  formatLogError(error) {
    const raw = String(error?.message || error || '').trim();
    const cleaned = raw
      .replace(/\{[\s\S]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);

    return {
      name: error?.name || 'Error',
      quota: this.isAiQuotaError(error),
      retrySeconds: this.extractRetrySecondsFromError(error),
      message: this.formatUserFacingError(error, 'zh').split('\n')[0],
      detail: cleaned || undefined
    };
  }

  buildAiModelCandidates(primaryModel = '', ...extraModels) {
    return Array.from(
      new Set(
        [
          primaryModel,
          ...extraModels,
          this.config.defaultModel,
          this.config.translationModel,
          this.config.routerModel,
          ...(this.config.availableModels || [])
        ]
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    );
  }

  async completeWithAiFallback({ scope = 'chat', model = '', request = {}, locale = 'zh' } = {}) {
    const candidates = this.buildAiModelCandidates(model);
    const skippedCooldowns = [];
    let lastQuotaError = null;

    for (const candidate of candidates) {
      const cooldown = this.getAiCooldown(scope, candidate);
      if (cooldown) {
        skippedCooldowns.push(cooldown);
        continue;
      }

      try {
        const result = await this.aiClient.completeWithTools({
          ...request,
          model: candidate
        });

        return {
          result,
          model: candidate
        };
      } catch (error) {
        if (this.isAiQuotaError(error)) {
          lastQuotaError = error;
          this.setAiCooldown(scope, candidate, error);
          this.logger.warn('AI model quota exhausted, trying fallback model', {
            scope,
            model: candidate,
            error: this.formatLogError(error)
          });
          continue;
        }

        throw error;
      }
    }

    const retrySeconds = Math.max(
      1,
      ...skippedCooldowns.map((item) => Number(item.retrySeconds || 0)),
      this.extractRetrySecondsFromError(lastQuotaError) || 60
    );

    throw new Error(`AI quota exceeded. Please retry in ${retrySeconds}s.`);
  }

  formatUserFacingError(error, locale = 'zh') {
    const raw = String(error?.message || error || '').trim();
    const lower = raw.toLowerCase();

    const retryMatch = raw.match(/retry in\s+([\d.]+)s/i);
    const retrySeconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : 0;

    const messages = {
      zh: {
        retry: retrySeconds > 0 ? `请大约 ${retrySeconds} 秒后再试。` : '请稍后再试。',
        quota: '请求太频繁了，当前 AI 额度暂时用完。',
        auth: 'AI 服务认证失败。可能是 API Key 无效、额度权限不足，或环境变量配置错误。',
        timeout: 'AI 服务响应超时。可能是网络不稳定或模型响应太慢，请稍后再试。',
        model: '当前模型不可用。可能是模型名称写错、API Key 不支持这个模型，或模型已经下线。',
        safety: '这条请求可能触发了安全限制，暂时无法处理。',
        network: '网络请求失败。请稍后再试。',
        generic: '处理失败，请稍后再试。'
      },
      en: {
        retry: retrySeconds > 0 ? `Please try again in about ${retrySeconds} seconds.` : 'Please try again later.',
        quota: 'Too many requests. The current AI quota is temporarily exhausted.',
        auth: 'AI service authentication failed. The API key may be invalid, unauthorized, or misconfigured.',
        timeout: 'The AI service timed out. The network may be unstable or the model may be responding too slowly.',
        model: 'The current model is unavailable. The model name may be wrong, unsupported, or deprecated.',
        safety: 'This request may have triggered a safety restriction and cannot be processed.',
        network: 'The network request failed. Please try again later.',
        generic: 'Something went wrong. Please try again later.'
      }
    };

    const lang = messages[locale] ? locale : 'zh';
    const t = messages[lang];

    if (
      raw.includes('429') ||
      raw.includes('RESOURCE_EXHAUSTED') ||
      lower.includes('quota') ||
      lower.includes('rate limit') ||
      lower.includes('rate-limit') ||
      lower.includes('generate_content_free_tier_requests')
    ) {
      return `${t.quota}\n${t.retry}`;
    }

    if (
      raw.includes('401') ||
      raw.includes('403') ||
      lower.includes('api key') ||
      lower.includes('permission') ||
      lower.includes('unauthorized') ||
      lower.includes('forbidden')
    ) {
      return t.auth;
    }

    if (
      lower.includes('timeout') ||
      lower.includes('timed out') ||
      lower.includes('etimedout') ||
      lower.includes('abort')
    ) {
      return t.timeout;
    }

    if (
      raw.includes('404') ||
      lower.includes('model not found') ||
      lower.includes('not found')
    ) {
      return t.model;
    }

    if (
      lower.includes('safety') ||
      lower.includes('blocked') ||
      lower.includes('prohibited')
    ) {
      return t.safety;
    }

    if (
      lower.includes('network') ||
      lower.includes('fetch failed') ||
      lower.includes('econnreset') ||
      lower.includes('enotfound') ||
      lower.includes('eai_again')
    ) {
      return t.network;
    }

    const shortMessage = raw
      .replace(/\{[\s\S]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    return shortMessage ? `${t.generic}\n${shortMessage}` : t.generic;
  }


  buildMemoryEnhancedSystemPrompt(basePrompt = '', memoryContext = null) {
    const prompt = String(basePrompt || '').trim();
    const memoryText = String(memoryContext?.text || '').trim();

    if (!memoryText) return prompt;

    return [
      prompt,
      '',
      'Memory and topic context:',
      memoryText,
      '',
      'Use the memory above only when it is relevant. If the user asks a side question, answer it clearly and then keep the previous main task in mind.'
    ].join('\n');
  }

  getProviderName() {
    return this.aiClient.getProviderName?.() || this.config.aiProvider || 'unknown';
  }

  createAssistantActionState(payload) {
    const token = randomUUID().replace(/-/g, '').slice(0, 16);
    while (this.assistantActionStates.size >= 200) {
      const oldest = this.assistantActionStates.keys().next().value;
      const oldestState = this.assistantActionStates.get(oldest);
      if (oldestState) {
        this.assistantActionStatesByMessage.delete(`${oldestState.chatId}:${oldestState.messageId}`);
      }
      this.assistantActionStates.delete(oldest);
    }
    const state = { ...payload, token, createdAt: Date.now() };
    this.assistantActionStates.set(token, state);
    this.assistantActionStatesByMessage.set(`${payload.chatId}:${payload.messageId}`, token);
    return state;
  }

  getAssistantActionStateByToken(token = '') {
    return this.assistantActionStates.get(token) || null;
  }

  getAssistantActionStateFromContext(ctx) {
    const callbackData = ctx.callbackQuery?.data || '';
    const tokenFromData = callbackData.split(':')[2] || '';
    const fromToken = this.getAssistantActionStateByToken(tokenFromData);
    if (fromToken) return fromToken;
    const messageId = ctx.callbackQuery?.message?.message_id;
    const chatId = ctx.chat?.id;
    if (!chatId || !messageId) return null;
    const fallbackToken = this.assistantActionStatesByMessage.get(`${chatId}:${messageId}`);
    return fallbackToken ? this.getAssistantActionStateByToken(fallbackToken) : null;
  }

  async applyAssistantActionKeyboard(ctx, keyboard) {
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (!messageId) return false;
    try {
      await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, messageId, undefined, keyboard.reply_markup);
      return true;
    } catch (error) {
      this.logger.warn('Failed to edit action keyboard', { chatId: ctx.chat?.id, error: error.message });
      return false;
    }
  }

  async editAssistantMessageText(ctx, text, keyboard = null) {
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (!messageId) return false;
    const editableText = splitMessage(String(text || ''), this.config.maxOutputChars)[0] || this.t(this.getLocale(ctx), 'noReply');
    const keyboardOptions = keyboard?.reply_markup ? { reply_markup: keyboard.reply_markup } : keyboard || undefined;
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        messageId,
        undefined,
        editableText,
        keyboardOptions
      );
      return true;
    } catch (error) {
      this.logger.warn('Failed to edit assistant message', { chatId: ctx.chat?.id, error: error.message });
      return false;
    }
  }

  async withCompactCallbackReply(ctx, handler) {
    const originalReply = ctx.reply.bind(ctx);
    let editedOnce = false;

    if (ctx.callbackQuery?.message) {
      ctx.reply = async (text, extra = {}) => {
        if (!editedOnce) {
          const editExtra = extra?.reply_markup
            ? { reply_markup: extra.reply_markup }
            : { ...extra };

          delete editExtra.reply_parameters;
          delete editExtra.reply_to_message_id;

          const editableText =
            splitMessage(cleanBotOutput(String(text || "")), this.config.maxOutputChars)[0] ||
            this.t(this.getLocale(ctx), "noReply");

          try {
            await ctx.editMessageText(editableText, editExtra);
            editedOnce = true;
            return ctx.callbackQuery.message;
          } catch (error) {
            const message = String(error?.description || error?.message || "");

            if (/message is not modified/i.test(message)) {
              try {
                await ctx.answerCbQuery();
              } catch {}
              editedOnce = true;
              return ctx.callbackQuery.message;
            }

            this.logger?.warn?.("Compact callback edit failed, fallback to reply", {
              chatId: ctx.chat?.id,
              error: message
            });
          }
        }

        return originalReply(text, extra);
      };
    }

    try {
      return await handler();
    } finally {
      ctx.reply = originalReply;
    }
  }

  async init() {
    this.bot.catch((error, ctx) => {
      this.logger.error('Telegram handler error', { chatId: ctx.chat?.id, error: this.formatLogError(error) });
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
      { command: "start", description: "Open button menu" },
      { command: "menu", description: "Open button menu" },
      { command: "whoami", description: "Show your Telegram ID" },
      { command: "status", description: "Admin: show bot status" }
    ]);
  }

  registerCommands() {
    this.bot.command('start', (ctx) => this.handleStart(ctx));
    this.bot.command('menu', (ctx) => this.handleMenu(ctx));
    this.bot.command('models', (ctx) => this.handleModels(ctx));
    this.bot.command('memory', (ctx) => this.handleMemoryPrompt(ctx));
    this.bot.command('reset', (ctx) => this.handleClearPrompt(ctx));
    this.bot.command('clear', (ctx) => this.handleClearPrompt(ctx));
    this.bot.command('topic', (ctx) => this.handleTopicShow(ctx));
    this.bot.command('topics', (ctx) => this.handleTopicsShow(ctx));
    this.bot.command('help', (ctx) => this.handleHelp(ctx));
    this.bot.command('status', (ctx) => this.handleStatus(ctx));
    this.bot.command('whoami', (ctx) => this.handleWhoami(ctx));
    this.bot.command('translate', (ctx) => this.runTranslation(ctx, extractCommandArgs(ctx.message.text || ''), 'auto'));
    this.bot.command('tr', (ctx) => this.runTranslation(ctx, extractCommandArgs(ctx.message.text || ''), 'auto'));
    this.bot.command('block', (ctx) => this.handleBlock(ctx, true));
    this.bot.command('unblock', (ctx) => this.handleBlock(ctx, false));
    this.bot.command('allow', (ctx) => this.handleAllow(ctx, true));
    this.bot.command('disallow', (ctx) => this.handleAllow(ctx, false));
    this.bot.action(/^set_model:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleModelCallback(ctx)));
    this.bot.action(/^set_persona:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handlePersonaCallback(ctx)));
    this.bot.action(/^set_language:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleLanguageCallback(ctx)));
    this.bot.action(/^menu:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleMenuCallback(ctx)));
    this.bot.action(/^admin_pick:(.+)$/, (ctx) => this.withCompactCallbackReply(ctx, () => this.handleAdminActionCallback(ctx)));
    this.bot.action(/^act:/, (ctx) => this.handleAssistantActionCallback(ctx));
  }

  isAdmin(ctx) {
    const userId = String(ctx.from?.id || '');
    if (this.accessControl) {
      return this.accessControl.isAdmin(userId);
    }
    return this.config.adminUserIds.has(userId);
  }

  isAllowed(ctx) {
    const userId = String(ctx.from?.id || '');
    const chatId = String(ctx.chat?.id || '');
    if (this.accessControl) {
      const decision = this.accessControl.canAccessBot({ userId, chatId });
      if (!decision.allowed) {
        this.db.logAudit({
          actorId: userId,
          actorType: 'telegram_user',
          action: 'telegram.access_deny',
          targetType: 'chat',
          targetId: chatId,
          result: 'deny',
          details: decision
        });
      }
      return decision.allowed;
    }
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
    const adminLine = this.isAdmin(ctx) ? `\n\n${this.t(locale, 'adminEntry')}` : '';
    await sendTextReply(
      ctx,
      `${this.t(locale, 'start')}${adminLine}`,
      this.config.maxOutputChars,
      this.createMenuKeyboard(locale)
    );
  }

  async handleWhoami(ctx) {
    const locale = this.getLocale(ctx);
    const userId = String(ctx.from?.id || '');
    const chatId = String(ctx.chat?.id || '');
    const username = ctx.from?.username ? `@${ctx.from.username}` : '-';
    const isAdmin = this.isAdmin(ctx) ? 'yes' : 'no';

    const text =
      locale === 'en'
        ? [
            '👤 Your Telegram info',
            '',
            `User ID: ${userId}`,
            `Chat ID: ${chatId}`,
            `Username: ${username}`,
            `Admin: ${isAdmin}`,
            '',
            'For Zeabur ADMIN_USER_IDS, use:',
            userId
          ].join('\n')
        : [
            '👤 你的 Telegram 信息',
            '',
            `用户 ID：${userId}`,
            `聊天 ID：${chatId}`,
            `用户名：${username}`,
            `管理员：${isAdmin}`,
            '',
            'Zeabur 的 ADMIN_USER_IDS 填这个：',
            userId
          ].join('\n');

    await sendTextReply(ctx, text, this.config.maxOutputChars, this.createMenuKeyboard(locale));
  }

  async handleHelp(ctx) {
    const locale = this.getLocale(ctx);

    if (locale === 'en') {
      const helpText = [
        '🆘 Help',
        '',
        'Main menu:',
        '💬 Chat — send any question directly.',
        '🌍 Translate — choose target language first, then send text.',
        '🧠 Memory — view memory, current topic, topic list, or clear memory.',
        '🤖 Models — view and switch available AI models.',
        '🧹 Clear — choose what to clear: current context, long-term memory, or all.',
        '🆘 Help — show this page.',
        '',
        'Reply buttons:',
        '🔄 Regenerate — regenerate the last answer.',
        '🧠 Model — switch model for future replies.',
        '🌍 Translate — translate this answer into a selected language.',
        '❤️ Favorite — save the answer.',
        '🗑 Context — clear current conversation context.',
        '',
        'Useful commands:',
        '/start — show main menu',
        '/help — show help',
        '/status — admin only: show bot status, models, quota cooldowns',
        '/whoami — show your Telegram ID',
        '/translate text — translate text automatically',
        '',
        'Notes:',
        '- If Gemini quota is exhausted, the bot will show a short cooldown message.',
        '- If fallback models are configured, the bot will try another model automatically.',
        '- Long-term memory and current chat context are separate.'
      ].join('\n');

      await sendTextReply(ctx, helpText, this.config.maxOutputChars, this.createMenuKeyboard(locale));
      return;
    }

    const helpText = [
      '🆘 帮助',
      '',
      '主菜单：',
      '💬 对话 —— 直接发问题就行。',
      '🌍 翻译 —— 先选目标语言，再发送要翻译的内容。',
      '🧠 记忆 —— 查看当前记忆、当前话题、话题列表，或清空记忆。',
      '🤖 模型 —— 查看并切换可用 AI 模型。',
      '🧹 清空 —— 可选择清空当前上下文、长期记忆，或全部清空。',
      '🆘 帮助 —— 显示这个页面。',
      '',
      '回复下方按钮：',
      '🔄 重生成 —— 重新生成上一条回答。',
      '🧠 模型 —— 切换后续回复使用的模型。',
      '🌍 翻译 —— 把这条回复翻译成指定语言。',
      '❤️ 收藏 —— 保存这条回复。',
      '🗑 上下文 —— 清空当前对话上下文。',
      '',
      '常用命令：',
      '/start —— 显示主菜单',
      '/help —— 显示帮助',
      '/status —— 管理员专用：查看 Bot 状态、模型、额度冷却',
      '/whoami —— 查看你的 Telegram 用户 ID',
      '/translate 文本 —— 自动翻译文本',
      '',
      '说明：',
      '- Gemini 额度用完时，Bot 会显示简洁冷却提示。',
      '- 如果配置了备用模型，Bot 会自动尝试切换模型。',
      '- 长期记忆和当前对话上下文是分开的。'
    ].join('\n');

    await sendTextReply(ctx, helpText, this.config.maxOutputChars, this.createMenuKeyboard(locale));
  }


  async handleClearPrompt(ctx) {
    const locale = this.getLocale(ctx);
    await ctx.reply(this.t(locale, 'clearPrompt'), this.createClearMemoryKeyboard(locale));
  }

  async handleClearTargetCallback(ctx) {
    const locale = this.getLocale(ctx);
    const target = String(ctx.match?.[1] || '').trim();

    await ctx.answerCbQuery();

    if (target === 'cancel') {
      await ctx.reply(this.t(locale, 'clearCancelled'), this.createMenuKeyboard(locale));
      return;
    }

    if (target === 'short') {
      await this.db.clearConversation(createSessionId(ctx));
      await ctx.reply(this.t(locale, 'shortMemoryCleared'), this.createMenuKeyboard(locale));
      return;
    }

    if (target === 'long') {
      await this.handleMemoryClear(ctx);
      return;
    }

    if (target === 'all') {
      const userId = ctx.from.id;
      const chatId = ctx.chat.id;

      await this.db.clearConversation(createSessionId(ctx));
      this.db.deleteMemoryItems?.({ userId, chatId });
      this.db.clearTopicStates?.({ userId, chatId });
      this.db.clearActiveContext?.({ userId, chatId });

      await ctx.reply(this.t(locale, 'allMemoryCleared'), this.createMenuKeyboard(locale));
      return;
    }

    await ctx.reply(this.t(locale, 'clearPrompt'), this.createClearMemoryKeyboard(locale));
  }

  async handleMemoryPrompt(ctx) {
    const locale = this.getLocale(ctx);
    await ctx.reply(this.t(locale, 'memoryPrompt'), this.createMemoryPanelKeyboard(locale));
  }

  async handleMemoryTargetCallback(ctx) {
    const locale = this.getLocale(ctx);
    const target = String(ctx.match?.[1] || '').trim();

    await ctx.answerCbQuery();

    if (target === 'cancel') {
      await ctx.reply(this.t(locale, 'clearCancelled'), this.createMenuKeyboard(locale));
      return;
    }

    if (target === 'current') {
      await this.handleMemoryShow(ctx);
      return;
    }

    if (target === 'topic') {
      await this.handleTopicShow(ctx);
      return;
    }

    if (target === 'topics') {
      await this.handleTopicsShow(ctx);
      return;
    }

    if (target === 'clear') {
      await this.handleClearPrompt(ctx);
      return;
    }

    await this.handleMemoryPrompt(ctx);
  }

  async handleMemoryShow(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const active = this.db.getActiveContext?.({ userId, chatId });
    const topicId = active?.activeTopicId || 'general';
    const items = this.db.getMemoryItems?.({ userId, chatId, topicId, limit: 20 }) || [];
    const topic = this.db.getTopicState?.({ userId, chatId, topicId });

    const lines = [];
    lines.push(`当前主线话题：${topicId}`);

    if (topic) {
      lines.push('');
      lines.push('话题状态：');
      if (topic.title) lines.push(`- 标题：${topic.title}`);
      if (topic.summary) lines.push(`- 总结：${topic.summary}`);
      if (topic.currentGoal) lines.push(`- 当前目标：${topic.currentGoal}`);
      if (topic.lastStep) lines.push(`- 上一步：${topic.lastStep}`);
      if (topic.nextStep) lines.push(`- 下一步：${topic.nextStep}`);
    }

    lines.push('');
    lines.push('长期记忆：');
    if (items.length === 0) {
      lines.push('- 暂无');
    } else {
      for (const item of items) {
        lines.push(`- ${item.key ? `${item.key}: ` : ''}${item.value}`);
      }
    }

    await sendTextReply(ctx, lines.join('\n'), this.config.maxOutputChars, this.createMenuKeyboard(this.getLocale(ctx)));
  }

  async handleTopicShow(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const active = this.db.getActiveContext?.({ userId, chatId });

    if (!active?.activeTopicId) {
      await ctx.reply('当前还没有主线话题。');
      return;
    }

    const topic = this.db.getTopicState?.({
      userId,
      chatId,
      topicId: active.activeTopicId
    });

    const lines = [
      `当前主线话题：${active.activeTopicId}`,
      active.returnTopicId ? `返回话题：${active.returnTopicId}` : ''
    ].filter(Boolean);

    if (topic) {
      if (topic.title) lines.push(`标题：${topic.title}`);
      if (topic.summary) lines.push(`总结：${topic.summary}`);
      if (topic.currentGoal) lines.push(`当前目标：${topic.currentGoal}`);
      if (topic.lastStep) lines.push(`上一步：${topic.lastStep}`);
      if (topic.nextStep) lines.push(`下一步：${topic.nextStep}`);
      if (topic.lastAccessedAt) lines.push(`最后访问：${topic.lastAccessedAt}`);
    }

    await sendTextReply(ctx, lines.join('\n'), this.config.maxOutputChars, this.createMenuKeyboard(this.getLocale(ctx)));
  }

  async handleTopicsShow(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const topics = this.db.listRecentTopicStates?.({ userId, chatId, limit: 10 }) || [];

    if (topics.length === 0) {
      await ctx.reply('还没有话题记录。');
      return;
    }

    const lines = ['最近话题：'];
    for (const topic of topics) {
      lines.push(`- ${topic.topicId}${topic.title ? `：${topic.title}` : ''}`);
      if (topic.currentGoal) lines.push(`  当前目标：${topic.currentGoal}`);
      if (topic.nextStep) lines.push(`  下一步：${topic.nextStep}`);
    }

    await sendTextReply(ctx, lines.join('\n'), this.config.maxOutputChars, this.createMenuKeyboard(this.getLocale(ctx)));
  }

  async handleMemoryClear(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const locale = this.getLocale(ctx);

    const memoryCount = this.db.deleteMemoryItems?.({ userId, chatId }) || 0;
    const topicCount = this.db.clearTopicStates?.({ userId, chatId }) || 0;
    this.db.clearActiveContext?.({ userId, chatId });

    if (locale === 'en') {
      await ctx.reply(`Long-term memory and topic state cleared.\nDeleted memory items: ${memoryCount}\nDeleted topics: ${topicCount}`, this.createMenuKeyboard(locale));
      return;
    }

    await ctx.reply(`已清空长期记忆和话题状态。\n删除记忆：${memoryCount}\n删除话题：${topicCount}`, this.createMenuKeyboard(locale));
  }


  async handleTopicsClear(ctx) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    const topicCount = this.db.clearTopicStates?.({ userId, chatId }) || 0;
    this.db.clearActiveContext?.({ userId, chatId });

    await ctx.reply(`已清空话题状态。\n删除话题：${topicCount}`);
  }

  async handleReset(ctx) {
    await this.db.clearConversation(createSessionId(ctx));
    const locale = this.getLocale(ctx);
    await ctx.reply(this.t(locale, 'shortMemoryCleared'), this.createMenuKeyboard(locale));
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

  async handlePluginCommand(ctx, commandName) {
    await this.pluginManager.runCommand(commandName, {
      bot: this,
      ctx,
      locale: this.getLocale(ctx)
    });
  }


  async runDocumentAction(ctx, mode = 'summarize') {
    const locale = this.getLocale(ctx);
    const document = ctx.message?.document;

    if (!document) {
      await ctx.reply('请直接发送 PDF、DOCX、XLSX、TXT、MD、JSON、CSV 或 XML 文件。', this.createFileActionKeyboard(locale));
      return;
    }

    try {
      await ctx.sendChatAction('typing');

      const file = await readTelegramFile(
        ctx,
        document.file_id,
        document.file_name || 'document.txt',
        document.mime_type || 'application/octet-stream'
      );

      const parsed = await this.documentParser.parse({
        buffer: file.buffer,
        filename: file.filename,
        mimeType: file.mimeType
      });

      if (!parsed.ok) {
        const key =
          parsed.error?.code === 'DOCUMENT_TOO_LARGE'
            ? 'documentTooLarge'
            : parsed.error?.code === 'DOCUMENT_PARSE_FAILED'
              ? 'documentParseFailed'
              : 'unsupportedDocument';

        await ctx.reply(this.t(locale, key, {
          filename: document.file_name || 'document',
          mimeType: document.mime_type || 'unknown',
          error: parsed.error?.message || ''
        }));

        return;
      }

      const extracted = truncateText(parsed.text || '', this.config.maxInputChars);
      if (!extracted) {
        await ctx.reply('文件里没有提取到可处理的文字内容。');
        return;
      }

      const instructions = {
        summarize:
          locale === 'en'
            ? 'Summarize the file clearly. Include the main topic, important details, and conclusion.'
            : '请清楚总结这个文件。包括主题、重要内容、结论和需要注意的地方。',
        keypoints:
          locale === 'en'
            ? 'Extract the key points from the file. Use concise bullet points and keep important numbers, names, dates, and action items.'
            : '请提取这个文件的重点。用简洁条目列出，保留重要数字、名称、日期和待办事项。',
        translate:
          locale === 'en'
            ? 'Translate the file content into Simplified Chinese. Output only the translation unless a short note is necessary.'
            : '请把这个文件内容翻译成简体中文。如果原文已经是中文，请翻译成自然英文。除非必要，不要额外解释。'
      };

      const completion = await this.completeWithAiFallback({
        scope: mode === 'translate' ? 'translation' : 'chat',
        model: mode === 'translate'
          ? this.config.translationModel || this.config.defaultModel
          : this.config.defaultModel,
        locale,
        request: {
          messages: [
            {
              role: 'system',
              content: instructions[mode] || instructions.summarize
            },
            {
              role: 'user',
              content: `File name: ${file.filename}\nMIME type: ${file.mimeType}\n\nFile text:\n${extracted}`
            }
          ],
          tools: [],
          temperature: 0.2
        }
      });

      await this.db.incrementStats('aiCalls');

      const title =
        mode === 'keypoints'
          ? '🎯 文件重点'
          : mode === 'translate'
            ? '🌍 文件翻译'
            : '📄 文件总结';

      await sendTextReply(
        ctx,
        `${title}\n\n${completion.result.text || this.t(locale, 'noReply')}`,
        this.config.maxOutputChars,
        this.createMenuKeyboard(locale)
      );
    } catch (error) {
      if (this.isAiQuotaError(error)) {
        this.setAiCooldown(mode === 'translate' ? 'translation' : 'chat', this.config.defaultModel, error);
      }

      this.logger.warn('Document action failed', {
        chatId: ctx.chat?.id,
        mode,
        error: this.formatLogError(error)
      });

      await ctx.reply(this.formatUserFacingError(error, locale));
    }
  }

  async runWebSearch(ctx, query = extractCommandArgs(ctx.message.text || '')) {
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
      }, {
        source: 'telegram_command',
        userId: ctx.from?.id,
        chatId: ctx.chat?.id,
        isAdmin: this.isAdmin(ctx),
        toolUsage: { count: 0 }
      });
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.error) {
          await ctx.reply(this.formatUserFacingError(parsed.message || parsed.error, locale));
          return;
        }
      } catch {
        // No-op, keep raw text path.
      }
      await this.db.incrementStats('toolCalls');
      await sendTextReply(ctx, this.t(locale, 'webResult', { result: raw }), this.config.maxOutputChars);
    } catch (error) {
      await ctx.reply(this.formatUserFacingError(error, locale));
    }
  }

  async runImageGeneration(ctx, prompt = extractCommandArgs(ctx.message.text || ''), mode = 'generate') {
    const locale = this.getLocale(ctx);
    if (!prompt) {
      await ctx.reply(this.t(locale, 'imageUsage'));
      return;
    }

    try {
      await ctx.sendChatAction('upload_photo');
      const result = await this.multimodalActions.runImageAction({
        mode,
        prompt
      });
      if (!result.ok) {
        const textKey = mode === 'edit' ? 'imageEditUnsupported' : 'imageUnsupported';
        await ctx.reply(this.t(locale, textKey, { provider: this.getProviderName() }));
        return;
      }
      const item = this.multimodalActions.pickImageResultItem(result.response);
      if (item?.type === 'url') {
        await ctx.replyWithPhoto(item.value, { caption: prompt });
        return;
      }
      if (item?.type === 'base64') {
        await ctx.replyWithPhoto({ source: Buffer.from(item.value, 'base64') }, { caption: prompt });
        return;
      }
      await ctx.reply(this.t(locale, 'imageEmpty'));
    } catch (error) {
      await ctx.reply(this.formatUserFacingError(error, locale));
    }
  }

  async runImageEdit(ctx, prompt = extractCommandArgs(ctx.message.text || '')) {
    const locale = this.getLocale(ctx);
    const photo = ctx.message?.photo?.[ctx.message.photo.length - 1];
    if (!photo) {
      await ctx.reply(this.t(locale, 'imageEditNeedPhoto'));
      return;
    }

    const file = await readTelegramFile(ctx, photo.file_id, 'image.jpg', 'image/jpeg');
    try {
      await ctx.sendChatAction('upload_photo');
      const result = await this.multimodalActions.runImageAction({
        mode: 'edit',
        prompt,
        imageBuffer: file.buffer,
        mimeType: file.mimeType
      });
      if (!result.ok) {
        await ctx.reply(this.t(locale, 'imageEditUnsupported', { provider: this.getProviderName() }));
        return;
      }
      const item = this.multimodalActions.pickImageResultItem(result.response);
      if (item?.type === 'url') {
        await ctx.replyWithPhoto(item.value, { caption: prompt });
        return;
      }
      if (item?.type === 'base64') {
        await ctx.replyWithPhoto({ source: Buffer.from(item.value, 'base64') }, { caption: prompt });
        return;
      }
      await ctx.reply(this.t(locale, 'imageEmpty'));
    } catch (error) {
      await ctx.reply(this.formatUserFacingError(error, locale));
    }
  }


  async runVoiceTranscription(ctx) {
    const locale = this.getLocale(ctx);
    const voice = ctx.message?.voice || ctx.message?.audio;

    if (!voice) {
      await ctx.reply('请直接发送 Telegram 语音消息或音频文件。', this.createVoiceActionKeyboard(locale));
      return;
    }

    try {
      await ctx.sendChatAction('typing');

      const file = await readTelegramFile(
        ctx,
        voice.file_id,
        voice.file_name || 'audio.ogg',
        voice.mime_type || 'audio/ogg'
      );

      const result = await this.audioOrchestrator.transcribeIncomingAudio({
        file,
        locale,
        userText: '',
        prompt: 'Transcribe the user audio accurately. Output only the transcription text.'
      });

      if (!result.ok) {
        await ctx.reply(this.formatUserFacingError(result.error || 'voice transcription failed', locale));
        return;
      }

      await this.db.incrementStats('voiceTranscriptions');

      const title = locale === 'en' ? '🎙 Transcription:' : '🎙 语音转文字结果：';
      await sendTextReply(ctx, `${title}\n\n${result.text || this.t(locale, 'noReply')}`, this.config.maxOutputChars, this.createMenuKeyboard(locale));
    } catch (error) {
      this.logger.warn('Voice transcription failed', {
        chatId: ctx.chat?.id,
        error: this.formatLogError(error)
      });
      await ctx.reply(this.formatUserFacingError(error, locale));
    }
  }

  async runTextToSpeech(ctx, text = extractCommandArgs(ctx.message.text || '')) {
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
      const result = await this.audioOrchestrator.textToSpeech({ input: text });
      if (!result.ok) {
        await ctx.reply(this.formatUserFacingError(result.error || 'unknown error', locale));
        return;
      }
      await this.db.incrementStats('aiCalls');
      await ctx.replyWithAudio({ source: result.audio, filename: 'speech.mp3' });
    } catch (error) {
      await ctx.reply(this.formatUserFacingError(error, locale));
    }
  }

  formatUptime(seconds = 0) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);

    return [
      days ? `${days}d` : '',
      hours ? `${hours}h` : '',
      `${minutes}m`
    ].filter(Boolean).join(' ');
  }

  listActiveAiCooldowns() {
    const entries = Array.from(this.aiCooldowns?.entries?.() || []);
    const nowMs = Date.now();

    return entries
      .map(([key, expiresAt]) => {
        const retrySeconds = Math.ceil((Number(expiresAt) - nowMs) / 1000);
        return { key, retrySeconds };
      })
      .filter((item) => item.retrySeconds > 0)
      .slice(0, 10);
  }

  async handleStatus(ctx) {
    const locale = this.getLocale(ctx);

    if (!this.isAdmin(ctx)) {
      await ctx.reply(this.t(locale, 'adminOnly'), this.createMenuKeyboard(locale));
      return;
    }

    const user = this.db.findUser(ctx.from.id);
    const stats = this.db.getStats?.() || {};
    const cooldowns = this.listActiveAiCooldowns();

    const models = Array.isArray(this.config.availableModels)
      ? this.config.availableModels.join(', ')
      : String(this.config.defaultModel || '');

    if (locale === 'en') {
      const lines = [
        '🤖 Bot status',
        `Provider: ${this.getProviderName()}`,
        `Default model: ${this.config.defaultModel}`,
        `Translation model: ${this.config.translationModel || this.config.defaultModel}`,
        `Router model: ${this.config.routerModel || this.config.defaultModel}`,
        `Available models: ${models}`,
        `AI Router: ${this.config.enableAiRouter ? this.config.aiRouterMode || 'smart' : 'off'}`,
        `Memory summary: every ${this.config.memorySummaryInterval || 5} turns`,
        `Today: ${user?.dailyUsageCount || 0}/${this.config.dailyQuota}`,
        `Total messages: ${user?.totalMessages || 0}`,
        `Uptime: ${this.formatUptime(process.uptime())}`,
        '',
        'AI cooldown:',
        cooldowns.length
          ? cooldowns.map((item) => `- ${item.key}: ${item.retrySeconds}s`).join('\n')
          : '- none',
        '',
        'Stats:',
        `- messagesHandled: ${stats.messagesHandled || 0}`,
        `- aiCalls: ${stats.aiCalls || 0}`,
        `- toolCalls: ${stats.toolCalls || 0}`
      ];

      await ctx.reply(lines.join('\n'), this.createMenuKeyboard(locale));
      return;
    }

    const lines = [
      '🤖 Bot 状态',
      `Provider：${this.getProviderName()}`,
      `默认模型：${this.config.defaultModel}`,
      `翻译模型：${this.config.translationModel || this.config.defaultModel}`,
      `Router 模型：${this.config.routerModel || this.config.defaultModel}`,
      `可用模型：${models}`,
      `AI Router：${this.config.enableAiRouter ? this.config.aiRouterMode || 'smart' : 'off'}`,
      `记忆总结：每 ${this.config.memorySummaryInterval || 5} 轮`,
      `今日用量：${user?.dailyUsageCount || 0}/${this.config.dailyQuota}`,
      `总消息数：${user?.totalMessages || 0}`,
      `运行时间：${this.formatUptime(process.uptime())}`,
      '',
      'AI 冷却：',
      cooldowns.length
        ? cooldowns.map((item) => `- ${item.key}：${item.retrySeconds}s`).join('\n')
        : '- 无',
      '',
      '统计：',
      `- messagesHandled：${stats.messagesHandled || 0}`,
      `- aiCalls：${stats.aiCalls || 0}`,
      `- toolCalls：${stats.toolCalls || 0}`
    ];

    await ctx.reply(lines.join('\n'), this.createMenuKeyboard(locale));
  }


  async handleAdminConfigCheck(ctx) {
    const locale = this.getLocale(ctx);

    if (!this.isAdmin(ctx)) {
      await ctx.reply(this.t(locale, 'adminOnly'));
      return;
    }

    const provider = this.getProviderName();
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
    const usesGemini = String(provider || this.config.aiProvider || '').toLowerCase().includes('gemini');

    const checks = [
      ['BOT_TOKEN', Boolean(process.env.BOT_TOKEN || this.config.botToken)],
      ['AI_PROVIDER', Boolean(provider || this.config.aiProvider)],
      ['GEMINI_API_KEY', usesGemini ? hasGeminiKey : true],
      ['AI_MODEL', Boolean(this.config.defaultModel)],
      ['ADMIN_USER_IDS', Boolean(this.config.adminUserIds?.size)],
      ['DATABASE_FILE', Boolean(process.env.DATABASE_FILE || this.config.databaseFile)],
      ['PORT / HEALTH_PORT', Boolean(process.env.PORT || process.env.HEALTH_PORT || this.config.port || this.config.healthPort)]
    ];

    const mark = (ok) => (ok ? '✅' : '⚠️');
    const checkLines = checks.map(([name, ok]) => `${mark(ok)} ${name}`);

    const models = Array.isArray(this.config.availableModels)
      ? this.config.availableModels.join(', ')
      : String(this.config.defaultModel || '');

    const lines =
      locale === 'en'
        ? [
            '🧭 Config check',
            '',
            ...checkLines,
            '',
            `Provider: ${provider}`,
            `Default model: ${this.config.defaultModel || '-'}`,
            `Translation model: ${this.config.translationModel || this.config.defaultModel || '-'}`,
            `Router model: ${this.config.routerModel || this.config.defaultModel || '-'}`,
            `Available models: ${models || '-'}`,
            '',
            `AI Router: ${this.config.enableAiRouter ? this.config.aiRouterMode || 'smart' : 'off'}`,
            `Memory summary interval: ${this.config.memorySummaryInterval || 5}`,
            `Tool calls: ${this.config.enableToolCalls ? 'on' : 'off'}`,
            `Live audio: ${this.config.enableLiveAudio ? 'on' : 'off'}`,
            '',
            'Secrets are only checked for presence and are not displayed.'
          ]
        : [
            '🧭 配置检查',
            '',
            ...checkLines,
            '',
            `Provider：${provider}`,
            `默认模型：${this.config.defaultModel || '-'}`,
            `翻译模型：${this.config.translationModel || this.config.defaultModel || '-'}`,
            `Router 模型：${this.config.routerModel || this.config.defaultModel || '-'}`,
            `可用模型：${models || '-'}`,
            '',
            `AI Router：${this.config.enableAiRouter ? this.config.aiRouterMode || 'smart' : 'off'}`,
            `记忆总结间隔：${this.config.memorySummaryInterval || 5}`,
            `工具调用：${this.config.enableToolCalls ? '开启' : '关闭'}`,
            `Live 语音：${this.config.enableLiveAudio ? '开启' : '关闭'}`,
            '',
            '密钥只检查是否存在，不会显示具体内容。'
          ];

    await ctx.reply(lines.join('\n'), this.createAdminActionKeyboard(locale));
  }

  async handleAdminVersion(ctx) {
    const locale = this.getLocale(ctx);

    if (!this.isAdmin(ctx)) {
      await ctx.reply(this.t(locale, 'adminOnly'));
      return;
    }

    const commit =
      process.env.ZEABUR_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      process.env.COMMIT_SHA ||
      process.env.SOURCE_COMMIT ||
      'unknown';

    const branch =
      process.env.ZEABUR_GIT_BRANCH ||
      process.env.GIT_BRANCH ||
      process.env.BRANCH ||
      'main';

    const lines =
      locale === 'en'
        ? [
            'ℹ️ Version info',
            '',
            `Node: ${process.version}`,
            `Branch: ${branch}`,
            `Commit: ${String(commit).slice(0, 12)}`,
            `Uptime: ${this.formatUptime(process.uptime())}`,
            `Provider: ${this.getProviderName()}`,
            `Model: ${this.config.defaultModel || '-'}`
          ]
        : [
            'ℹ️ 版本信息',
            '',
            `Node：${process.version}`,
            `分支：${branch}`,
            `提交：${String(commit).slice(0, 12)}`,
            `运行时间：${this.formatUptime(process.uptime())}`,
            `Provider：${this.getProviderName()}`,
            `模型：${this.config.defaultModel || '-'}`
          ];

    await ctx.reply(lines.join('\n'), this.createAdminActionKeyboard(locale));
  }

  async handleAdminAiTest(ctx) {
    const locale = this.getLocale(ctx);
    const model = this.config.defaultModel;

    if (!this.isAdmin(ctx)) {
      await ctx.reply(this.t(locale, "adminOnly"));
      return;
    }

    try {
      await ctx.sendChatAction("typing");

      const completion = await this.completeWithAiFallback({
        scope: "chat",
        model,
        locale,
        request: {
          messages: [
            {
              role: "system",
              content: "You are a deployment health checker. Reply with a very short OK message."
            },
            {
              role: "user",
              content: "Reply exactly: AI_OK"
            }
          ],
          tools: [],
          temperature: 0
        }
      });

      await this.db.incrementStats("aiCalls");

      const usedModel = completion.model || model;
      const text = completion.result?.text || "";

      const lines =
        locale === "en"
          ? [
              "🧪 AI test passed",
              "",
              `Provider: ${this.getProviderName()}`,
              `Model: ${usedModel}`,
              `Reply: ${text}`
            ]
          : [
              "🧪 AI 测试通过",
              "",
              `Provider：${this.getProviderName()}`,
              `实际模型：${usedModel}`,
              `模型回复：${text}`
            ];

      await ctx.reply(lines.join("\n"), this.createAdminActionKeyboard(locale));
    } catch (error) {
      if (this.isAiQuotaError(error)) {
        this.setAiCooldown("chat", model, error);
      }

      this.logger.warn("Admin AI test failed", {
        chatId: ctx.chat?.id,
        error: this.formatLogError(error)
      });

      const lines =
        locale === "en"
          ? [
              "🧪 AI test failed",
              "",
              this.formatUserFacingError(error, locale),
              "",
              "Check AI_PROVIDER, GEMINI_API_KEY, AI_MODEL, and fallback models."
            ]
          : [
              "🧪 AI 测试失败",
              "",
              this.formatUserFacingError(error, locale),
              "",
              "请检查 AI_PROVIDER、GEMINI_API_KEY、AI_MODEL、AI_FALLBACK_MODELS。"
            ];

      await ctx.reply(lines.join("\n"), this.createAdminActionKeyboard(locale));
    }
  }

  async handleAdminQuota(ctx) {
    const locale = this.getLocale(ctx);
    const user = this.db.findUser(ctx.from.id);
    const stats = this.db.getStats?.() || {};
    const cooldowns = Array.from(this.aiCooldowns.entries()).map(([key, expiresAt]) => ({
      key,
      retrySeconds: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
    })).filter((item) => item.retrySeconds > 0);

    if (locale === 'en') {
      const lines = [
        '📊 Quota status',
        '',
        `Today used: ${user?.dailyUsageCount || 0}/${this.config.dailyQuota}`,
        `Total messages: ${user?.totalMessages || 0}`,
        '',
        'AI cooldown:',
        cooldowns.length
          ? cooldowns.map((item) => `- ${item.key}: ${item.retrySeconds}s`).join('\n')
          : '- none',
        '',
        'Global stats:',
        `- messagesHandled: ${stats.messagesHandled || 0}`,
        `- aiCalls: ${stats.aiCalls || 0}`,
        `- toolCalls: ${stats.toolCalls || 0}`,
        `- voiceTranscriptions: ${stats.voiceTranscriptions || 0}`,
        `- imageGenerations: ${stats.imageGenerations || 0}`,
        `- ttsGenerations: ${stats.ttsGenerations || 0}`
      ];

      await ctx.reply(lines.join('\n'), this.createAdminActionKeyboard(locale));
      return;
    }

    const lines = [
      '📊 额度状态',
      '',
      `今日用量：${user?.dailyUsageCount || 0}/${this.config.dailyQuota}`,
      `总消息数：${user?.totalMessages || 0}`,
      '',
      'AI 冷却：',
      cooldowns.length
        ? cooldowns.map((item) => `- ${item.key}：${item.retrySeconds}s`).join('\n')
        : '- 无',
      '',
      '全局统计：',
      `- messagesHandled：${stats.messagesHandled || 0}`,
      `- aiCalls：${stats.aiCalls || 0}`,
      `- toolCalls：${stats.toolCalls || 0}`,
      `- voiceTranscriptions：${stats.voiceTranscriptions || 0}`,
      `- imageGenerations：${stats.imageGenerations || 0}`,
      `- ttsGenerations：${stats.ttsGenerations || 0}`
    ];

    await ctx.reply(lines.join('\n'), this.createAdminActionKeyboard(locale));
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

  async handleTranslateTargetCallback(ctx) {
    const locale = this.getLocale(ctx);
    const code = String(ctx.match?.[1] || 'auto');
    const targetLanguage = this.resolveTranslationTargetCode(code);

    this.setPendingMenuAction(ctx, {
      type: 'translate_prompt',
      targetLanguage
    });

    await ctx.answerCbQuery();
    await ctx.reply(
      `${this.t(locale, 'translationSendPrompt')}\n目标语言：${targetLanguage === 'auto' ? 'auto' : targetLanguage}`,
      this.createMenuKeyboard(locale)
    );
  }





  async handleAdminActionCallback(ctx) {
    const locale = this.getLocale(ctx);
    const target = String(ctx.match?.[1] || '').trim();

    await ctx.answerCbQuery();

    if (target === 'cancel') {
      await this.handleMenu(ctx);
      return;
    }

    if (!this.isAdmin(ctx)) {
      await ctx.reply(this.t(locale, 'adminOnly'));
      await this.handleWhoami(ctx);
      return;
    }

    if (target === 'status') {
      await this.handleStatus(ctx);
      return;
    }

    if (target === 'whoami') {
      await this.handleWhoami(ctx);
      return;
    }

    if (target === 'models') {
      await this.handleModels(ctx);
      return;
    }

    if (target === 'quota') {
      await this.handleAdminQuota(ctx);
      return;
    }

    if (target === 'ai_test') {
      await this.handleAdminAiTest(ctx);
      return;
    }

    if (target === 'back') {
      await ctx.reply('🛠 管理员面板', this.createAdminActionKeyboard(locale));
      return;
    }

    if (target === 'config_check') {
      await this.handleAdminConfigCheck(ctx);
      return;
    }

    if (target === 'version') {
      await this.handleAdminVersion(ctx);
      return;
    }

    if (target === 'docs') {
      const text =
        locale === 'en'
          ? '📚 Deploy docs\n\nTap a button below to open the document.'
          : '📚 部署文档\n\n点击下面按钮打开对应文档。';

      await ctx.reply(text, this.createDeployDocsKeyboard(locale));
      return;
    }

    await ctx.reply('🛠 管理员面板', this.createAdminActionKeyboard(locale));
  }

  async handleFileActionCallback(ctx) {
    const locale = this.getLocale(ctx);
    const target = String(ctx.match?.[1] || '').trim();

    await ctx.answerCbQuery();

    if (target === 'cancel') {
      await this.handleMenu(ctx);
      return;
    }

    const pendingMap = {
      summarize: 'file_summarize_prompt',
      keypoints: 'file_keypoints_prompt',
      translate: 'file_translate_prompt'
    };

    const titleMap =
      locale === 'en'
        ? {
            summarize: '📄 Summarize file',
            keypoints: '🎯 Extract key points',
            translate: '🌍 Translate file'
          }
        : {
            summarize: '📄 总结文件',
            keypoints: '🎯 提取重点',
            translate: '🌍 翻译文件'
          };

    const pending = pendingMap[target];
    if (!pending) {
      await ctx.reply('📎 请选择文件功能：', this.createFileActionKeyboard(locale));
      return;
    }

    this.setPendingMenuAction(ctx, pending);

    await ctx.reply(
      `${titleMap[target]}\n\n请直接发送 PDF、DOCX、XLSX、TXT、MD、JSON、CSV 或 XML 文件。`,
      this.createMenuKeyboard(locale)
    );
  }

  async handleVoiceActionCallback(ctx) {
    const locale = this.getLocale(ctx);
    const target = String(ctx.match?.[1] || '').trim();

    await ctx.answerCbQuery();

    if (target === 'cancel') {
      await this.handleMenu(ctx);
      return;
    }

    if (target === 'transcribe') {
      this.setPendingMenuAction(ctx, 'voice_transcribe_prompt');
      await ctx.reply('🎙 语音转文字\n\n请直接发送 Telegram 语音消息或音频文件。', this.createMenuKeyboard(locale));
      return;
    }

    if (target === 'tts') {
      this.setPendingMenuAction(ctx, 'voice_tts_prompt');
      await ctx.reply('🔊 文字转语音\n\n请直接发送要朗读的文字，不需要输入指令。', this.createMenuKeyboard(locale));
      return;
    }

    if (target === 'live') {
      this.setPendingMenuAction(ctx, 'voice_live_prompt');
      await ctx.reply(
        '🎧 Gemini Live\n\n这个入口已预留。后续会接 Gemini Live / Native Audio Dialog。\n\n现在可先使用语音转文字和文字转语音。',
        this.createVoiceActionKeyboard(locale)
      );
      return;
    }

    await ctx.reply('🎤 请选择语音功能：', this.createVoiceActionKeyboard(locale));
  }

  async handleImageActionCallback(ctx) {
    const locale = this.getLocale(ctx);
    const target = String(ctx.match?.[1] || '').trim();

    await ctx.answerCbQuery();

    if (target === 'cancel') {
      await this.handleMenu(ctx);
      return;
    }

    if (target === 'understand') {
      this.setPendingMenuAction(ctx, 'image_understand_prompt');
      await ctx.reply('🔍 图片识别\n\n请直接发送图片给我。', this.createMenuKeyboard(locale));
      return;
    }

    if (target === 'generate') {
      this.setPendingMenuAction(ctx, 'image_generate_prompt');
      await ctx.reply('🎨 生成图片\n\n请直接发送图片描述，不需要输入指令。', this.createMenuKeyboard(locale));
      return;
    }

    if (target === 'edit') {
      this.setPendingMenuAction(ctx, 'image_edit_prompt');
      await ctx.reply('🛠 编辑图片\n\n请发送要编辑的图片，并在图片说明里写编辑要求。', this.createMenuKeyboard(locale));
      return;
    }

    await ctx.reply('🖼️ 请选择图片功能：', this.createImageActionKeyboard(locale));
  }

  async handleAssistantActionCallback(ctx) {
    const parts = String(ctx.callbackQuery?.data || '').split(':');
    const action = parts[1] || '';
    const token = parts[2] || '';
    const state = this.getAssistantActionStateByToken(token);
    const locale = this.getLocale(ctx);

    if (!state) {
      await ctx.answerCbQuery(this.t(locale, 'actionNoContext'));
      return;
    }
    if (String(state.userId) !== String(ctx.from?.id)) {
      await ctx.answerCbQuery(this.t(locale, 'adminOnly'));
      return;
    }

    try {
      if (action === 'more') {
        await ctx.answerCbQuery();
        await this.applyAssistantActionKeyboard(ctx, this.createAssistantMoreKeyboard(state.locale, token));
        return;
      }
      if (action === 'back') {
        await ctx.answerCbQuery();
        await this.applyAssistantActionKeyboard(ctx, this.createAssistantActionKeyboard(state.locale, token));
        return;
      }
      if (action === 'model') {
        const user = this.db.findUser(state.userId);
        await ctx.answerCbQuery();
        await this.applyAssistantActionKeyboard(
          ctx,
          this.createAssistantModelKeyboard(state.locale, token, user?.preferredModel || state.model || this.config.defaultModel)
        );
        return;
      }
      if (action === 'model_pick') {
        const index = Number(parts[3]);
        const model = this.config.availableModels[index];
        await ctx.answerCbQuery();
        if (!model) return;
        await this.db.setUserSettings(state.userId, { preferredModel: model });
        state.model = model;
        await this.applyAssistantActionKeyboard(ctx, this.createAssistantActionKeyboard(state.locale, token));
        return;
      }
      if (action === 'persona') {
        const user = this.db.findUser(state.userId);
        await ctx.answerCbQuery();
        await this.applyAssistantActionKeyboard(
          ctx,
          this.createAssistantPersonaKeyboard(state.locale, token, user?.persona || 'default')
        );
        return;
      }
      if (action === 'persona_pick') {
        const persona = parts[3] || '';
        await ctx.answerCbQuery();
        if (!(persona in personaPresets)) return;
        await this.db.setUserSettings(state.userId, { persona, customSystemPrompt: '' });
        await this.applyAssistantActionKeyboard(ctx, this.createAssistantMoreKeyboard(state.locale, token));
        return;
      }
      if (action === 'language') {
        const user = this.db.findUser(state.userId);
        await ctx.answerCbQuery();
        await this.applyAssistantActionKeyboard(
          ctx,
          this.createAssistantLanguageKeyboard(state.locale, token, user?.preferredLanguage || state.locale || 'zh')
        );
        return;
      }
      if (action === 'language_pick') {
        const language = this.normalizeLanguageInput(parts[3] || '');
        await ctx.answerCbQuery();
        if (!language) return;
        await this.db.setUserSettings(state.userId, { preferredLanguage: language });
        state.locale = language;
        await this.applyAssistantActionKeyboard(ctx, this.createAssistantActionKeyboard(state.locale, token));
        return;
      }
      if (action === 'favorite') {
        const favoriteTargetId = state.assistantMessageVersionId || state.messageId;
        const existing = this.db.findFavorite(state.chatId, state.userId, favoriteTargetId);
        if (existing) {
          await ctx.answerCbQuery(this.t(state.locale, 'actionAlreadySaved'));
          return;
        }
        await this.db.saveFavorite({
          chatId: state.chatId,
          userId: state.userId,
          sessionId: state.sessionId,
          messageId: state.messageId,
          messageVersionId: state.assistantMessageVersionId || '',
          targetType: state.assistantMessageVersionId ? 'message_version' : 'message',
          targetId: favoriteTargetId,
          text: state.replyText,
          sourceText: state.sourceText,
          model: state.model,
          locale: state.locale
        });
        await ctx.answerCbQuery(this.t(state.locale, 'actionSaved'));
        return;
      }
      if (action === 'clear') {
        await this.db.clearConversation(state.sessionId);
        await ctx.answerCbQuery(this.t(state.locale, 'actionContextCleared'));
        return;
      }
      if (action === 'translate') {
        await ctx.answerCbQuery();
        await this.applyAssistantActionKeyboard(ctx, this.createAssistantTranslationKeyboard(state.locale, token));
        return;
      }
      if (action === 'translate_pick') {
        const targetLanguage = this.resolveTranslationTargetCode(parts[3] || 'auto');
        const translationModel = this.config.translationModel || state.model || this.config.defaultModel;
        const translationCooldown = this.getAiCooldown('translation', translationModel);
        if (translationCooldown) {
          await ctx.answerCbQuery(this.formatQuotaCooldownMessage(translationCooldown, state.locale).slice(0, 180));
          return;
        }

        await ctx.answerCbQuery(this.t(state.locale, 'actionWorking'));
        const translated = await this.translateAssistantReply(state, targetLanguage);
        if (!translated) return;
        state.replyText = translated;
        await this.editAssistantMessageText(ctx, translated, this.createAssistantActionKeyboard(state.locale, token));
        return;
      }
      if (action === 'regen') {
        const user = this.db.findUser(state.userId);
        const regenModel = user?.preferredModel || state.model || this.config.defaultModel;
        const regenCooldown = this.getAiCooldown('chat', regenModel);
        if (regenCooldown) {
          await ctx.answerCbQuery(this.formatQuotaCooldownMessage(regenCooldown, state.locale).slice(0, 180));
          return;
        }

        await ctx.answerCbQuery(this.t(state.locale, 'actionWorking'));
        const regenerated = await this.regenerateAssistantReply(state);
        if (!regenerated?.text) return;
        state.replyText = regenerated.text;
        state.assistantMessageId = regenerated.assistantRef?.messageId || state.assistantMessageId || '';
        state.assistantMessageVersionId = regenerated.assistantRef?.messageVersionId || state.assistantMessageVersionId || '';
        await this.editAssistantMessageText(ctx, regenerated.text, this.createAssistantActionKeyboard(state.locale, token));
        return;
      }
      await ctx.answerCbQuery();
    } catch (error) {
      if (this.isAiQuotaError(error)) {
        const scope = action === 'translate_pick' || action === 'translate' ? 'translation' : 'chat';
        const model = scope === 'translation'
          ? this.config.translationModel || state?.model || this.config.defaultModel
          : state?.model || this.config.defaultModel;
        this.setAiCooldown(scope, model, error);
      }

      this.logger.warn('Assistant callback action failed', {
        chatId: ctx.chat?.id,
        action,
        error: this.formatLogError(error)
      });
      await ctx.answerCbQuery(this.formatUserFacingError(error, state?.locale || locale).slice(0, 180));
    }
  }

  async translateAssistantReply(state, targetLanguage = 'auto') {
    const resolvedTarget = String(targetLanguage || 'auto').trim();

    let prompt = '';
    if (!resolvedTarget || resolvedTarget === 'auto') {
      const targetLocale = state.locale === 'zh' ? 'en' : 'zh';
      prompt =
        targetLocale === 'zh'
          ? '请将下面内容翻译成简体中文，只输出翻译结果，不要额外说明。'
          : 'Translate the content below to English and output translation only.';
    } else {
      prompt = `Translate the content below into ${resolvedTarget}. Output the translation only. Do not add explanations.`;
    }

    const completion = await this.completeWithAiFallback({
      scope: 'translation',
      model: this.config.translationModel || state.model || this.config.defaultModel,
      locale: state.locale || 'zh',
      request: {
        messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: state.replyText || '' }
      ],
        tools: []
      }
    });
    const result = completion.result;
    return result.text || '';
  }


  async regenerateAssistantReply(state) {
    if (!state?.systemMessage || !state?.preparedMessage || !state?.sessionId) {
      this.logger.warn('Skip regenerate: incomplete state payload', {
        hasSystemMessage: Boolean(state?.systemMessage),
        hasPreparedMessage: Boolean(state?.preparedMessage),
        hasSessionId: Boolean(state?.sessionId)
      });
      return null;
    }
    const user = this.db.findUser(state.userId);
    const model = user?.preferredModel || state.model || this.config.defaultModel;
    const completion = await this.completeWithAiFallback({
      scope: 'chat',
      model,
      locale: state.locale || 'zh',
      request: {
        messages: [state.systemMessage, ...(state.historyBefore || []), state.preparedMessage],
        tools:
        this.config.enableToolCalls && this.getProviderCapabilities().toolCalls
          ? this.toolRegistry.getDefinitions()
          : [],
        toolRunner: async (toolCall) => {
          const output = await this.toolRegistry.execute(toolCall, {
            source: 'assistant_regenerate',
            userId: state.userId,
            chatId: state.chatId,
            isAdmin: this.config.adminUserIds.has(String(state.userId)),
            toolUsage: state.toolUsage || (state.toolUsage = { count: 0 })
          });
          await this.db.incrementStats('toolCalls');
          return output;
        }
      }
    });
    const result = completion.result;
    await this.db.setConversation(
      state.sessionId,
      buildConversationHistory(
        result.messages.filter((item) => item.role !== 'system'),
        this.config.maxHistoryMessages
      )
    );
    state.model = model;
    return {
      text: result.text || '',
      assistantRef: this.db.getLatestAssistantMessageReference(state.sessionId)
    };
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
    await this.editAssistantMessageText(ctx, this.t(locale, 'modelSwitched', { model }), this.createModelKeyboard(model));
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
    await this.editAssistantMessageText(ctx, this.t(locale, 'personaSwitched', { persona }), this.createPersonaKeyboard(persona));
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
    await this.editAssistantMessageText(
      ctx,
      this.t(language, 'languageSet', { language: LANGUAGE_NAMES[language] || language }),
      this.createLanguageKeyboard(language)
    );
  }


  async handleMenuCallback(ctx) {
    const action = String(ctx.match?.[1] || '').trim();
    const actionMap = {
      chat: { type: 'chat_hint' },
      translate: { type: 'translate_prompt' },
      memory: { type: 'memory_prompt' },
      help: { type: 'help' },
      reset: { type: 'reset' },
      models: { type: 'models' },
      persona: { type: 'persona' },
      web: { type: 'web_prompt' },
      image: { type: 'image_menu' },
      file: { type: 'file_menu' },
      tts: { type: 'voice_menu' },
      language: { type: 'language' },
      admin: { type: 'admin_menu' },
      back: { type: 'main_menu' }
    };

    await ctx.answerCbQuery();

    const handled = await this.handleMenuAction(ctx, actionMap[action]);
    if (!handled) {
      await this.handleMenu(ctx);
    }
  }

  async handleMenuAction(ctx, naturalAction, locale = this.getLocale(ctx)) {
    if (!naturalAction) return false;

    if (naturalAction.type === 'main_menu') {
      await this.handleMenu(ctx);
      return true;
    }

    if (naturalAction.type === 'chat_hint') {
      await ctx.reply(this.t(locale, 'chatHint'), this.createMenuKeyboard(locale));
      return true;
    }

    if (naturalAction.type === 'translate_prompt') {
      await ctx.reply(this.t(locale, 'translationTargetPrompt'), this.createTranslationTargetKeyboard(locale));
      return true;
    }

    if (naturalAction.type === 'help') {
      await this.handleHelp(ctx);
      return true;
    }

    if (naturalAction.type === 'reset') {
      await this.handleClearPrompt(ctx);
      return true;
    }

    if (naturalAction.type === 'models') {
      await this.handleModels(ctx);
      return true;
    }

    if (naturalAction.type === 'persona') {
      const user = this.db.findUser(ctx.from.id);
      await ctx.reply(
        this.t(locale, 'currentPersona', {
          persona: user?.persona || 'default',
          options: Object.keys(personaPresets).join(', ')
        }),
        this.createPersonaKeyboard(user?.persona || 'default')
      );
      return true;
    }

    if (naturalAction.type === 'language') {
      const user = this.db.findUser(ctx.from.id);
      await ctx.reply(
        this.t(locale, 'currentLanguage', { language: LANGUAGE_NAMES[user?.preferredLanguage || locale] || locale }),
        this.createLanguageKeyboard(user?.preferredLanguage || locale)
      );
      return true;
    }

    if (naturalAction.type === 'memory_prompt') {
      await this.handleMemoryPrompt(ctx);
      return true;
    }

    if (naturalAction.type === 'memory_show') {
      await this.handleMemoryShow(ctx);
      return true;
    }

    if (naturalAction.type === 'topic_show') {
      await this.handleTopicShow(ctx);
      return true;
    }

    if (naturalAction.type === 'topics_show') {
      await this.handleTopicsShow(ctx);
      return true;
    }

    if (naturalAction.type === 'memory_clear') {
      await this.handleClearPrompt(ctx);
      return true;
    }

    if (naturalAction.type === 'topics_clear') {
      await this.handleTopicsClear(ctx);
      return true;
    }

    if (naturalAction.type === 'web') {
      await this.runWebSearch(ctx, naturalAction.value);
      return true;
    }

    if (naturalAction.type === 'image') {
      await this.runImageGeneration(ctx, naturalAction.value, 'generate');
      return true;
    }

    if (naturalAction.type === 'image_edit') {
      await this.runImageEdit(ctx, naturalAction.value);
      return true;
    }

    if (naturalAction.type === 'tts') {
      await this.runTextToSpeech(ctx, naturalAction.value);
      return true;
    }

    if (naturalAction.type === 'image_menu') {
      await ctx.reply('🖼️ 请选择图片功能：', this.createImageActionKeyboard(locale));
      return true;
    }

    if (naturalAction.type === 'voice_menu') {
      await ctx.reply('🎤 请选择语音功能：', this.createVoiceActionKeyboard(locale));
      return true;
    }

    if (naturalAction.type === 'file_menu') {
      await ctx.reply('📎 请选择文件功能：', this.createFileActionKeyboard(locale));
      return true;
    }

    if (naturalAction.type === 'admin_menu') {
      if (!this.isAdmin(ctx)) {
        await ctx.reply(this.t(locale, 'adminOnly'));
        await this.handleWhoami(ctx);
        return true;
      }

      await ctx.reply('🛠 管理员面板', this.createAdminActionKeyboard(locale));
      return true;
    }

    if (naturalAction.type === 'web_prompt') {
      this.setPendingMenuAction(ctx, 'web_prompt');
      await ctx.reply('🌐 联网搜索\n\n请直接发送你要搜索的内容，不需要输入“搜索”两个字。', this.createMenuKeyboard(locale));
      return true;
    }

    if (naturalAction.type === 'image_prompt') {
      this.setPendingMenuAction(ctx, 'image_prompt');
      await ctx.reply('🖼️ 图片识别\n\n请直接发送图片，不需要输入指令。', this.createMenuKeyboard(locale));
      return true;
    }

    if (naturalAction.type === 'tts_prompt') {
      this.setPendingMenuAction(ctx, 'voice_prompt');
      await ctx.reply('🎤 语音消息\n\n请直接发送 Telegram 语音消息。\n\n说明：TTS 朗读和 Gemini Live 后面再单独接。', this.createMenuKeyboard(locale));
      return true;
    }

    if (naturalAction.type === 'model') {
      ctx.message = ctx.message || {};
      ctx.message.text = `/model ${naturalAction.value}`;
      await this.handleModel(ctx);
      return true;
    }

    if (naturalAction.type === 'persona_set') {
      ctx.message = ctx.message || {};
      ctx.message.text = `/persona ${naturalAction.value}`;
      await this.handlePersona(ctx);
      return true;
    }

    if (naturalAction.type === 'language_set') {
      ctx.message = ctx.message || {};
      ctx.message.text = `/language ${naturalAction.value}`;
      await this.handleLanguage(ctx);
      return true;
    }

    if (await this.pluginManager.runNaturalAction(naturalAction, { bot: this, ctx, locale })) {
      return true;
    }

    return false;
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

    const translationRequest = text ? this.parseTranslationRequest(text) : null;
    if (translationRequest) {
      return this.runTranslation(ctx, translationRequest.text, translationRequest.targetLanguage);
    }

    const naturalAction = text ? this.parseNaturalLanguageAction(text, locale) : null;

    // 先处理按钮本身，避免“上一个按钮”等待输入时把新按钮当成内容
    if (naturalAction) {
      if (await this.handleMenuAction(ctx, naturalAction, locale)) return;
    }

    // 只有不是按钮的新消息，才作为上一个按钮的输入
    const pendingAction = this.takePendingMenuAction(ctx);
    if (pendingAction) {
      const handled = await this.handlePendingMenuAction(ctx, pendingAction);
      if (handled !== false) return;
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

    let memoryContext = null;
    try {
      this.memoryManager.rememberProjectDefaults({
        userId: ctx.from.id,
        chatId: ctx.chat.id
      });
      memoryContext = this.memoryManager.getMemoryContext({
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        text: text || caption
      });
      this.memoryManager.updateAfterUserMessage({
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        memoryContext,
        userText: text || caption
      });
    } catch (error) {
      this.logger.warn('Memory context unavailable', { error: error.message });
      memoryContext = null;
    }

    let routedIntent = null;
    if (text && this.shouldUseAiRouter(text)) {
      routedIntent = await this.classifyUserIntent(ctx, text, memoryContext);

      if (routedIntent?.topicId && memoryContext) {
        memoryContext.topicId = routedIntent.topicId;
        if (routedIntent.isSideQuestion && routedIntent.returnTopicId) {
          memoryContext.isSideQuestion = true;
          memoryContext.returnTopicId = routedIntent.returnTopicId;
        }
      }

      if (routedIntent?.intent && routedIntent.intent !== 'chat') {
        const routedHandled = await this.handleRoutedIntent(ctx, routedIntent, locale);
        if (routedHandled) return;
      }
    }

    let activeAiModel = user?.preferredModel || chat?.defaultModel || this.config.defaultModel;

    try {
      const model = activeAiModel;
      const chatCooldown = this.getAiCooldown('chat', model);
      if (chatCooldown) {
        await ctx.reply(this.formatQuotaCooldownMessage(chatCooldown, locale));
        return;
      }

      await ctx.sendChatAction('typing');
      const prepared = await this.prepareUserMessage(ctx);
      const sessionId = createSessionId(ctx);
      const storedContext = this.db.getConversationForContext(sessionId, {
        maxMessages: this.config.maxHistoryMessages,
        strategy: 'recent'
      });
      const history = buildConversationHistory(storedContext, this.config.maxHistoryMessages);
      const baseSystemPrompt = createSystemPrompt(this.config, chat || {}, user || { persona: 'default', customSystemPrompt: '' }, locale);
      const systemMessage = {
        role: 'system',
        content: this.buildMemoryEnhancedSystemPrompt(baseSystemPrompt, memoryContext)
      };

      const messages = [systemMessage, ...history, prepared.message];
      const toolUsage = { count: 0 };
      const completion = await this.completeWithAiFallback({
        scope: 'chat',
        model,
        locale,
        request: {
          messages,
          tools:
          this.config.enableToolCalls && this.getProviderCapabilities().toolCalls
            ? this.toolRegistry.getDefinitions()
            : [],
          toolRunner: async (toolCall) => {
            const output = await this.toolRegistry.execute(toolCall, {
              source: 'assistant_chat',
              userId: ctx.from?.id,
              chatId: ctx.chat?.id,
              isAdmin: this.isAdmin(ctx),
              toolUsage
            });
            await this.db.incrementStats('toolCalls');
            return output;
          }
        }
      });

      const result = completion.result;
      activeAiModel = completion.model || model;

      await this.db.incrementStats('messagesHandled');
      await this.db.incrementStats('aiCalls');
      await this.db.setConversation(
        sessionId,
        buildConversationHistory(
          result.messages.filter((item) => item.role !== 'system'),
          this.config.maxHistoryMessages
        )
      );
      const assistantRef = this.db.getLatestAssistantMessageReference(sessionId);

      const assistantText = result.text || this.t(locale, 'noReply');

      try {
        await this.memoryManager.updateAfterAssistantReply({
          userId: ctx.from.id,
          chatId: ctx.chat.id,
          memoryContext,
          userText: text || caption,
          assistantText
        });
      } catch (error) {
        this.logger.warn('Failed to update memory after reply', { error: this.formatLogError(error) });
      }

      const reply = await this.sendAssistantReply(ctx, assistantText);
      if (reply?.lastMessageId) {
        const state = this.createAssistantActionState({
          chatId: ctx.chat.id,
          userId: ctx.from.id,
          messageId: reply.lastMessageId,
          sessionId,
          locale,
          model,
          preparedMessage: prepared.message,
          historyBefore: history,
          systemMessage,
          memoryContext,
          routedIntent,
          sourceText: typeof prepared.message?.content === 'string' ? prepared.message.content : text || caption || '',
          replyText: assistantText,
          assistantMessageId: assistantRef?.messageId || '',
          assistantMessageVersionId: assistantRef?.messageVersionId || ''
        });
        await ctx.telegram.editMessageReplyMarkup(
          ctx.chat.id,
          reply.lastMessageId,
          undefined,
          this.createAssistantActionKeyboard(locale, state.token).reply_markup
        );
      }
    } catch (error) {
      if (this.isAiQuotaError(error)) {
        this.setAiCooldown('chat', activeAiModel, error);
      }

      this.logger.error('Failed to handle message', { error: this.formatLogError(error) });
      await ctx.reply(this.formatUserFacingError(error, locale));
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
      const prepared = this.multimodalActions.createImageUnderstandingMessage({
        locale,
        text: decoratedText,
        file
      });
      if (!prepared.ok) {
        return {
          message: {
            role: 'user',
            content: [
              decoratedText,
              this.t(locale, 'noVisionSupport')
            ]
              .filter(Boolean)
              .join('\n\n')
          }
        };
      }
      return {
        message: prepared.message
      };
    }

    if (ctx.message.voice || ctx.message.audio) {
      const voice = ctx.message.voice || ctx.message.audio;
      const file = await readTelegramFile(
        ctx,
        voice.file_id,
        voice.file_name || 'audio.ogg',
        voice.mime_type || 'audio/ogg'
      );
      const audioResult = await this.audioOrchestrator.transcribeIncomingAudio({
        file,
        locale,
        userText: decoratedText,
        prompt: 'Transcribe the user audio accurately.'
      });
      if (!audioResult.ok) {
        return {
          message: {
            role: 'user',
            content: [decoratedText, this.t(locale, 'noTranscriptionSupport')].filter(Boolean).join('\n\n')
          }
        };
      }
      return {
        message: {
          role: 'user',
          content: audioResult.text
        }
      };
    }

    if (ctx.message.document) {
      const document = ctx.message.document;
      const file = await readTelegramFile(
        ctx,
        document.file_id,
        document.file_name || 'document.txt',
        document.mime_type || 'application/octet-stream'
      );
      const parsed = await this.documentParser.parse({
        buffer: file.buffer,
        filename: file.filename,
        mimeType: file.mimeType
      });

      if (!parsed.ok) {
        const key =
          parsed.error?.code === 'DOCUMENT_TOO_LARGE'
            ? 'documentTooLarge'
            : parsed.error?.code === 'DOCUMENT_PARSE_FAILED'
              ? 'documentParseFailed'
              : 'unsupportedDocument';
        return {
          message: {
            role: 'user',
            content: `${decoratedText}\n\n${this.t(locale, key, {
              filename: document.file_name || 'document',
              mimeType: document.mime_type,
              error: parsed.error?.message || ''
            })}`.trim()
          }
        };
      }
      const extracted = truncateText(parsed.text, this.config.maxInputChars);
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

  async sendAssistantReply(ctx, text, extra = {}) {
    const chunks = splitMessage(text, this.config.maxOutputChars);
    let lastMessageId = null;
    for (const chunk of chunks) {
      if (!this.config.enableStreamingReplies) {
        const sent = await ctx.reply(chunk, {
          ...extra,
          reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined
        });
        lastMessageId = sent?.message_id || lastMessageId;
        continue;
      }

      const frames = createStreamingFrames(chunk, this.config.streamingMinLength);
      if (frames.length <= 1) {
        const sent = await ctx.reply(chunk, {
          ...extra,
          reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined
        });
        lastMessageId = sent?.message_id || lastMessageId;
        continue;
      }

      const sent = await ctx.reply(this.t(this.getLocale(ctx), 'streamingPlaceholder'), {
        ...extra,
        reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined
      });
      lastMessageId = sent?.message_id || lastMessageId;

      let streamFailed = false;
      let lastFrame = '';
      for (const frame of frames) {
        if (frame === lastFrame) continue;

        const updated = await this.tryEditStreamingMessage(ctx, sent.message_id, frame, extra);
        if (!updated) {
          streamFailed = true;
          break;
        }

        lastFrame = frame;
        if (frame !== frames[frames.length - 1]) {
          await delay(this.config.streamingEditIntervalMs);
        }
      }

      if (streamFailed && lastFrame !== chunk) {
        const fallback = await ctx.reply(chunk, {
          ...extra,
          reply_parameters: ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined
        });
        lastMessageId = fallback?.message_id || lastMessageId;
      }
    }
    return { lastMessageId };
  }

  async tryEditStreamingMessage(ctx, messageId, text, extra = {}) {
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text, extra);
      return true;
    } catch (error) {
      this.logger.warn('Streaming edit failed, retrying once', { chatId: ctx.chat?.id, error: error.message });
      await delay(this.config.streamingEditIntervalMs * 2);
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text, extra);
        return true;
      } catch (retryError) {
        this.logger.warn('Streaming edit fallback failed', { chatId: ctx.chat?.id, error: retryError.message });
        return false;
      }
    }
  }
}
