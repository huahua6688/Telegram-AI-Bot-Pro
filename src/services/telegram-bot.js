import { Telegraf } from 'telegraf';
import { extractCommandArgs, normalizeCommand, shouldRespondToMessage } from '../utils/telegram.js';
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

function createSystemPrompt(config, chatSettings, userSettings) {
  const personaPrompt = userSettings.customSystemPrompt || personaPresets[userSettings.persona] || config.systemPrompt;
  const chatPrompt = chatSettings.systemPrompt ? `\n\nChat instructions: ${chatSettings.systemPrompt}` : '';
  return `${personaPrompt}${chatPrompt}`.trim();
}

function createSessionId(ctx) {
  const chatId = String(ctx.chat.id);
  const userId = String(ctx.from?.id || 'anonymous');
  const threadId = ctx.message?.message_thread_id ? String(ctx.message.message_thread_id) : 'main';
  return `${chatId}:${userId}:${threadId}`;
}

async function sendTextReply(ctx, text, maxLength) {
  const chunks = splitMessage(text, maxLength);
  for (const chunk of chunks) {
    await ctx.reply(chunk, {
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
    await sendTextReply(
      ctx,
      '你好，我已经准备好了。支持多轮对话、群聊触发、联网搜索、图片理解、语音转文字、TTS、图片生成、模型切换、管理员控制和持久记忆。发送 /help 查看详细说明。',
      this.config.maxOutputChars
    );
  }

  async handleHelp(ctx) {
    const helpText = [
      '可用能力：',
      '- 文本对话：私聊直接发消息，群聊支持 @我 / 回复我 / 关键词触发',
      '- /reset 或 /clear：清空当前会话记忆',
      '- /models：查看可用模型',
      '- /model [name]：切换当前用户默认模型',
      '- /persona [default|coder|translator|teacher|writer]：切换人格',
      '- /web [query]：联网搜索',
      '- /image [prompt]：生成图片',
      '- /tts [text]：生成语音',
      '- 直接发送图片：自动识别图片内容',
      '- 直接发送语音：自动转文字并继续对话',
      '- 发送文本文件：自动读取并总结',
      '- /chatmode [smart|all|mention|reply|keyword]：群聊触发模式',
      '- /keyword [text]：设置群聊关键词',
      '- /stats：查看统计信息',
      '- 管理员：/block /unblock /allow /disallow [userId]'
    ].join('\n');

    await sendTextReply(ctx, helpText, this.config.maxOutputChars);
  }

  async handleReset(ctx) {
    await this.db.clearConversation(createSessionId(ctx));
    await ctx.reply('当前会话记忆已清空。');
  }

  async handleModels(ctx) {
    const user = this.db.findUser(ctx.from.id);
    const current = user?.preferredModel || this.config.defaultModel;
    const models = this.config.availableModels.length > 0 ? this.config.availableModels.join(', ') : this.config.defaultModel;
    await ctx.reply(`当前模型：${current}\n可用模型：${models}`);
  }

  async handleModel(ctx) {
    const arg = extractCommandArgs(ctx.message.text || '');
    const user = this.db.findUser(ctx.from.id);

    if (!arg) {
      await ctx.reply(`当前模型：${user?.preferredModel || this.config.defaultModel}`);
      return;
    }

    if (!this.config.availableModels.includes(arg)) {
      await ctx.reply(`模型不可用。可选：${this.config.availableModels.join(', ')}`);
      return;
    }

    await this.db.setUserSettings(ctx.from.id, { preferredModel: arg });
    await ctx.reply(`已切换到模型：${arg}`);
  }

  async handlePersona(ctx) {
    const arg = extractCommandArgs(ctx.message.text || '');
    const user = this.db.findUser(ctx.from.id);

    if (!arg) {
      await ctx.reply(`当前人格：${user?.persona || 'default'}\n可选：${Object.keys(personaPresets).join(', ')}`);
      return;
    }

    if (!(arg in personaPresets)) {
      await ctx.reply(`不支持的人格。可选：${Object.keys(personaPresets).join(', ')}`);
      return;
    }

    await this.db.setUserSettings(ctx.from.id, { persona: arg, customSystemPrompt: '' });
    await ctx.reply(`已切换人格：${arg}`);
  }

  async handleWeb(ctx) {
    const query = extractCommandArgs(ctx.message.text || '');
    if (!query) {
      await ctx.reply('用法：/web 你的搜索关键词');
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
      await sendTextReply(ctx, `联网搜索结果：\n${raw}`, this.config.maxOutputChars);
    } catch (error) {
      await ctx.reply(`搜索失败：${error.message}`);
    }
  }

  async handleImage(ctx) {
    const prompt = extractCommandArgs(ctx.message.text || '');
    if (!prompt) {
      await ctx.reply('用法：/image 你的图片描述');
      return;
    }

    const capabilities = this.getProviderCapabilities();
    if (!capabilities.imageGeneration) {
      await ctx.reply(`当前提供商 ${this.getProviderName()} 不支持图片生成。请切换到支持图片能力的平台。`);
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
      await ctx.reply('图片接口返回了空结果。');
    } catch (error) {
      await ctx.reply(`图片生成失败：${error.message}`);
    }
  }

  async handleTts(ctx) {
    const text = extractCommandArgs(ctx.message.text || '');
    if (!text) {
      await ctx.reply('用法：/tts 你想转换成语音的文本');
      return;
    }

    const capabilities = this.getProviderCapabilities();
    if (!capabilities.speechSynthesis) {
      await ctx.reply(`当前提供商 ${this.getProviderName()} 不支持文字转语音。请切换到支持语音能力的平台。`);
      return;
    }

    try {
      await ctx.sendChatAction('record_voice');
      const audio = await this.aiClient.generateSpeech({ input: truncateText(text, 4000) });
      await this.db.incrementStats('aiCalls');
      await this.db.incrementStats('ttsGenerations');
      await ctx.replyWithAudio({ source: audio, filename: 'speech.mp3' });
    } catch (error) {
      await ctx.reply(`TTS 失败：${error.message}`);
    }
  }

  async handleStats(ctx) {
    const stats = this.db.getStats();
    const user = this.db.findUser(ctx.from.id);
    if (!this.isAdmin(ctx)) {
      await ctx.reply(`你的今日额度已用：${user?.dailyUsageCount || 0}/${this.config.dailyQuota}\n累计消息：${user?.totalMessages || 0}`);
      return;
    }

    await ctx.reply(
      [
        '全局统计：',
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
    if (ctx.chat.type === 'private') {
      await ctx.reply('该命令仅用于群聊。');
      return;
    }

    const mode = extractCommandArgs(ctx.message.text || '');
    const allowed = ['smart', 'all', 'mention', 'reply', 'keyword'];
    if (!mode || !allowed.includes(mode)) {
      await ctx.reply(`用法：/chatmode ${allowed.join('|')}`);
      return;
    }

    await this.db.setChatSettings(ctx.chat.id, { triggerMode: mode });
    await ctx.reply(`群聊触发模式已设置为：${mode}`);
  }

  async handleKeyword(ctx) {
    if (ctx.chat.type === 'private') {
      await ctx.reply('该命令仅用于群聊。');
      return;
    }

    const keyword = extractCommandArgs(ctx.message.text || '');
    if (!keyword) {
      await ctx.reply('用法：/keyword 触发关键词');
      return;
    }

    await this.db.setChatSettings(ctx.chat.id, { keyword });
    await ctx.reply(`群聊触发关键词已设置为：${keyword}`);
  }

  async handleBlock(ctx, blocked) {
    if (!this.isAdmin(ctx)) {
      await ctx.reply('只有管理员可以执行此命令。');
      return;
    }

    const userId = extractCommandArgs(ctx.message.text || '');
    if (!userId) {
      await ctx.reply(`用法：/${blocked ? 'block' : 'unblock'} 用户ID`);
      return;
    }

    await this.db.setUserSettings(userId, { isBlocked: blocked });
    await ctx.reply(blocked ? `已封禁用户：${userId}` : `已解除封禁：${userId}`);
  }

  async handleAllow(ctx, allowed) {
    if (!this.isAdmin(ctx)) {
      await ctx.reply('只有管理员可以执行此命令。');
      return;
    }

    const userId = extractCommandArgs(ctx.message.text || '');
    if (!userId) {
      await ctx.reply(`用法：/${allowed ? 'allow' : 'disallow'} 用户ID`);
      return;
    }

    await this.db.setUserSettings(userId, { isAllowed: allowed });
    await ctx.reply(allowed ? `已放行用户：${userId}` : `已取消放行：${userId}`);
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
      await ctx.reply('你当前没有使用权限。');
      return;
    }

    if (!this.checkRateLimit(ctx.from.id)) {
      await ctx.reply('请求过于频繁，请稍后再试。');
      return;
    }

    const quota = this.db.consumeDailyQuota(ctx.from.id, this.config.dailyQuota);
    await this.db.write();
    if (!quota.allowed) {
      await ctx.reply('你今天的使用额度已经用完，请明天再来。');
      return;
    }

    try {
      await ctx.sendChatAction('typing');
      const prepared = await this.prepareUserMessage(ctx);
      const model = user?.preferredModel || chat?.defaultModel || this.config.defaultModel;
      const sessionId = createSessionId(ctx);
      const history = this.db.getConversation(sessionId).slice(-this.config.maxHistoryMessages);
      const systemMessage = {
        role: 'system',
        content: createSystemPrompt(this.config, chat || {}, user || { persona: 'default', customSystemPrompt: '' })
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
        result.messages.filter((item) => item.role !== 'system').slice(-this.config.maxHistoryMessages * 2)
      );

      await sendTextReply(ctx, result.text || '抱歉，这次没有拿到有效回复。', this.config.maxOutputChars);
    } catch (error) {
      this.logger.error('Failed to handle message', error);
      await ctx.reply(`处理消息失败：${error.message}`);
    }
  }

  async prepareUserMessage(ctx) {
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
            { type: 'text', text: decoratedText || '请分析这张图片。' },
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
              '用户发送了语音消息，但当前模型提供商不支持语音转文字。请提醒用户改发文字，或切换支持语音转写的平台。'
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
            content: `${decoratedText}\n\nThe user uploaded a file named ${document.file_name || 'document'} with type ${document.mime_type}. Explain that only text-like files are summarized directly.`
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
        content: decoratedText || '请继续。'
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
