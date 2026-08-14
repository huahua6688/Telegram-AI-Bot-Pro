import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import {
  MemoryManager,
  isSafeLongTermMemory,
  rankMemoryItems
} from '../src/services/memory-manager.js';
import { ToolRegistry } from '../src/services/tool-registry.js';
import {
  TelegramAIBot,
  cleanBotOutput,
  formatNewsRichMarkdown,
  sanitizeRichMarkdown
} from '../src/services/telegram-bot.js';
import { PrivacyTelegramAIBot } from '../src/services/privacy-telegram-bot.js';
import {
  naturalAgentInternals,
  tryHandleNaturalAgent
} from '../src/services/natural-agent.js';
import { MultimodalActionService } from '../src/services/multimodal-action-service.js';
import { AudioOrchestrator } from '../src/services/audio-orchestrator.js';

function logger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {}
  };
}

function toolConfig() {
  return {
    enableToolCalls: true,
    enableWebSearch: false,
    enableUrlFetch: false,
    toolAllowedNames: new Set(['get_time', 'ghost_tool']),
    toolAllowedUserIds: new Set(),
    toolAllowedChatIds: new Set(),
    toolBlockedUserIds: new Set(),
    toolAdminOnlyNames: new Set(),
    toolMaxCallsPerMessage: 4,
    toolUserWindowMs: 60000,
    toolUserMaxCalls: 20,
    networkToolScope: 'all',
    networkToolAllowedUserIds: new Set(),
    networkToolAllowedChatIds: new Set()
  };
}

test('context budget defaults to a useful bounded window', () => {
  const previous = process.env.MAX_CONTEXT_CHARS;
  delete process.env.MAX_CONTEXT_CHARS;

  try {
    assert.equal(loadConfig().maxContextChars, 48000);
  } finally {
    if (previous === undefined) delete process.env.MAX_CONTEXT_CHARS;
    else process.env.MAX_CONTEXT_CHARS = previous;
  }
});

test('long-term memory rejects credentials and ranks relevant preferences first', () => {
  assert.equal(
    isSafeLongTermMemory({ key: 'api_key', value: 'sk-example-secret-1234567890' }),
    false
  );
  assert.equal(
    isSafeLongTermMemory({ key: 'reply_style', value: 'Prefer concise Chinese replies.' }),
    true
  );

  const ranked = rankMemoryItems(
    [
      { key: 'travel', value: 'Likes window seats', memoryType: 'preference', topicId: 'travel' },
      { key: 'reply_style', value: 'Prefer concise Chinese replies', memoryType: 'preference', topicId: 'general' },
      { key: 'project', value: 'Telegram bot deployment', memoryType: 'project', topicId: 'general' }
    ],
    'Please keep the Chinese reply concise',
    'general'
  );

  assert.equal(ranked[0].key, 'reply_style');
});

test('memory summarization stores only safe high-confidence facts', async () => {
  const stored = [];
  const db = {
    getTopicState() {
      return null;
    },
    upsertTopicState() {},
    upsertMemoryItem(item) {
      stored.push(item);
    }
  };
  const manager = new MemoryManager({
    db,
    config: {
      enableMemorySummary: true,
      memorySummaryInterval: 1,
      defaultModel: 'test-model'
    },
    logger: logger(),
    aiClient: {
      async completeWithTools() {
        return {
          text: JSON.stringify({
            title: 'Preferences',
            summary: 'The user prefers concise Chinese replies.',
            importantMemory: [
              {
                key: 'reply_style',
                value: 'Prefer concise Chinese replies.',
                memoryType: 'preference',
                confidence: 0.95
              },
              {
                key: 'api_key',
                value: 'sk-example-secret-1234567890',
                memoryType: 'fact',
                confidence: 0.99
              },
              {
                key: 'uncertain_guess',
                value: 'Might like long replies.',
                memoryType: 'preference',
                confidence: 0.3
              }
            ]
          })
        };
      }
    }
  });

  await manager.updateAfterAssistantReply({
    userId: '1',
    chatId: '2',
    memoryContext: { topicId: 'general', title: 'General' },
    userText: 'Please reply concisely in Chinese.',
    assistantText: '好的。'
  });

  assert.deepEqual(stored.map((item) => item.key), ['reply_style']);
  assert.equal(stored[0].confidence, 0.95);
});

test('tool failures return structured results instead of crashing the agent loop', async () => {
  const registry = new ToolRegistry(toolConfig(), logger());
  const malformed = JSON.parse(
    await registry.execute({ function: { name: 'get_time', arguments: '{bad' } })
  );
  const unsupported = JSON.parse(
    await registry.execute({ function: { name: 'ghost_tool', arguments: '{}' } })
  );

  assert.equal(malformed.error, 'TOOL_ARGS_INVALID');
  assert.equal(unsupported.error, 'TOOL_NOT_FOUND');
  assert.equal(unsupported.ok, false);
});

test('assistant replies are cleaned before the main Telegram send path', async () => {
  const sent = [];
  const fakeBot = {
    config: {
      maxOutputChars: 4000,
      enableStreamingReplies: false
    }
  };
  const ctx = {
    message: { message_id: 42 },
    reply: async (text, extra) => {
      sent.push({ text, extra });
      return { message_id: sent.length };
    }
  };

  await TelegramAIBot.prototype.sendAssistantReply.call(
    fakeBot,
    ctx,
    '***重点***\n\n**不要保留星号**\n\n***\n\n### 标题'
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, '重点\n\n不要保留星号\n标题');
  assert.doesNotMatch(sent[0].text, /\*{2,}/);
});

test('structured private replies use Telegram rich messages with safe regular fallback', async () => {
  const calls = [];
  const fakeBot = {
    config: { enableRichMessages: true, richMessageMinChars: 200 },
    logger: logger()
  };
  const markdown = '# Report\n\n' + '- useful item\n'.repeat(25);
  const ctx = {
    chat: { id: 77, type: 'private' },
    message: { message_id: 42 },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        return { message_id: 91 };
      }
    }
  };

  const sent = await TelegramAIBot.prototype.trySendRichAssistantReply.call(fakeBot, ctx, markdown);
  assert.equal(sent.lastMessageId, 91);
  assert.equal(sent.rich, true);
  assert.equal(calls[0].method, 'sendRichMessage');
  assert.equal(calls[0].payload.rich_message.markdown, markdown.trim());

  calls.length = 0;
  const shortNews = '# 今日新闻\n\n1. 一条带来源的新闻';
  const forced = await TelegramAIBot.prototype.trySendRichAssistantReply.call(
    fakeBot,
    ctx,
    shortNews,
    {},
    { force: true, kind: 'news' }
  );
  assert.equal(forced.rich, true);
  assert.equal(calls[0].payload.rich_message.markdown, shortNews);

  ctx.telegram.callApi = async () => { throw new Error('method unavailable'); };
  assert.equal(await TelegramAIBot.prototype.trySendRichAssistantReply.call(fakeBot, ctx, markdown), null);
});

test('recent Rich Message text is restored from private in-memory context when Telegram omits it in a reply', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = {
    enableRichMessages: true,
    richMessageMinChars: 20,
    maxInputChars: 4000
  };
  bot.logger = logger();
  bot.richReplyContexts = new Map();
  const markdown = '# 今日新闻\n\n- 第一条有来源的新闻内容';
  const sendContext = {
    chat: { id: 77, type: 'private' },
    message: { message_id: 42 },
    telegram: {
      async callApi() {
        return { message_id: 91 };
      }
    }
  };

  await bot.trySendRichAssistantReply(sendContext, markdown, {}, { force: true, kind: 'news' });
  const replyContext = {
    chat: { id: 77, type: 'private' },
    message: {
      message_id: 43,
      text: '第一条是什么意思？',
      reply_to_message: {
        message_id: 91,
        from: { is_bot: true },
        rich_message: { blocks: [] }
      }
    }
  };

  assert.equal(bot.hydrateRichReplyContext(replyContext), true);
  assert.equal(replyContext.message.reply_to_message.text, markdown);
  assert.equal(bot.richReplyContexts.size, 1);
});

test('provider fragments use one throttled rich draft and let final model structure choose persistence', async () => {
  const calls = [];
  const plainReplies = [];
  const fakeBot = {
    config: {
      enableStreamingReplies: true,
      enableRichMessages: true,
      streamingEditIntervalMs: 350,
      maxOutputChars: 4096,
      richMessageMinChars: 600
    },
    logger: logger(),
    trySendRichAssistantReply: TelegramAIBot.prototype.trySendRichAssistantReply,
    getLocale() { return 'en'; },
    t() { return 'No reply.'; }
  };
  const ctx = {
    chat: { id: 77, type: 'private' },
    message: { message_id: 42 },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        return method === 'sendRichMessage' ? { message_id: 92 } : true;
      }
    },
    async reply(text) {
      plainReplies.push(text);
      return { message_id: 92 };
    }
  };

  const streamer = TelegramAIBot.prototype.createAssistantDraftStreamer.call(fakeBot, ctx);
  await streamer.onTextDelta('Streaming ans', 'Streaming answer');
  await streamer.onTextDelta(' continues', 'Streaming answer continues');
  assert.equal(streamer.sent, true);
  assert.equal(streamer.rich, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'sendRichMessageDraft');
  assert.equal(calls[0].payload.chat_id, 77);
  assert.ok(calls[0].payload.draft_id > 0);
  assert.equal(calls[0].payload.rich_message.markdown, 'Streaming answer');

  const final = await TelegramAIBot.prototype.sendAssistantReply.call(
    fakeBot,
    ctx,
    'Streaming answer continues',
    {},
    { skipSimulatedStreaming: true }
  );
  assert.equal(final.lastMessageId, 92);
  assert.deepEqual(plainReplies, ['Streaming answer continues']);
  assert.equal(calls.length, 1);
});

test('rich draft failures fall back to the existing plain Telegram draft', async () => {
  const calls = [];
  const warnings = [];
  const fakeBot = {
    config: {
      enableStreamingReplies: true,
      enableRichMessages: true,
      streamingEditIntervalMs: 350,
      maxOutputChars: 4096
    },
    logger: { warn(message) { warnings.push(message); } }
  };
  const ctx = {
    chat: { id: 77, type: 'private' },
    message: { message_id: 42 },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        if (method === 'sendRichMessageDraft') throw new Error('method not found');
        return true;
      }
    }
  };

  const streamer = TelegramAIBot.prototype.createAssistantDraftStreamer.call(fakeBot, ctx);
  await streamer.onTextDelta('**Streaming**', '**Streaming answer**');

  assert.equal(streamer.sent, true);
  assert.equal(streamer.rich, false);
  assert.deepEqual(calls.map((item) => item.method), ['sendRichMessageDraft', 'sendMessageDraft']);
  assert.equal(calls[0].payload.rich_message.markdown, '**Streaming answer**');
  assert.equal(calls[1].payload.text, 'Streaming answer');
  assert.equal(warnings.length, 1);
});

test('short code selected by the model still uses rich rendering without forcing ordinary replies', async () => {
  const calls = [];
  const fakeBot = {
    config: { enableRichMessages: true, richMessageMinChars: 600 },
    logger: logger()
  };
  const ctx = {
    chat: { id: 77, type: 'private' },
    message: { message_id: 42 },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        return { message_id: 93 };
      }
    }
  };

  const result = await TelegramAIBot.prototype.trySendRichAssistantReply.call(
    fakeBot,
    ctx,
    '```js\nconsole.log("ok");\n```'
  );
  assert.equal(result.rich, true);
  assert.equal(calls[0].method, 'sendRichMessage');
});

test('rich table output removes unsupported breaks, duplicate sources, and malformed URL suffixes', () => {
  const markdown = sanitizeRichMarkdown([
    '# AI overview',
    '',
    '| Direction | Progress |',
    '|---|---|',
    '| Models | First item<br>Second item |',
    '',
    '参考来源（点击可查看原文）',
    '1. Provider name – detailed report title',
    '',
    '参考来源：',
    '1. [Provider](https://example.com/report%22,)'
  ].join('\n'));

  assert.match(markdown, /\| Models \| First item；Second item \|/);
  assert.doesNotMatch(markdown, /<br|参考来源（点击可查看原文）|%22,/i);
  assert.match(markdown, /\[Provider name – detailed report title\]\(https:\/\/example\.com\/report\)/);
  assert.doesNotMatch(markdown, /\[Provider\]\(/);
});

test('wide rich tables use a vertical layout before Telegram delivery', async () => {
  const calls = [];
  const fakeBot = {
    config: { enableRichMessages: true, richMessageMinChars: 200 },
    logger: logger()
  };
  const ctx = {
    chat: { id: 77, type: 'private' },
    message: { message_id: 42 },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        return { message_id: 94 };
      }
    }
  };
  const markdown = '# Report\n\n| Direction | Progress | Impact |\n|---|---|---|\n| Models | Faster<br>Smarter | Better tools |';

  const result = await TelegramAIBot.prototype.trySendRichAssistantReply.call(fakeBot, ctx, markdown);

  assert.equal(result.rich, true);
  assert.equal(result.layout, 'vertical');
  assert.equal(calls.length, 1);
  assert.match(calls[0].payload.rich_message.markdown, /### Models/);
  assert.match(calls[0].payload.rich_message.markdown, /\*\*Progress：\*\* Faster；Smarter/);
  assert.doesNotMatch(calls[0].payload.rich_message.markdown, /^\|/m);
});

test('a compact rejected table still retries once as a vertical layout', async () => {
  const calls = [];
  const fakeBot = {
    config: { enableRichMessages: true, richMessageMinChars: 20 },
    logger: logger()
  };
  const ctx = {
    chat: { id: 77, type: 'private' },
    message: { message_id: 42 },
    telegram: {
      async callApi(method, payload) {
        calls.push({ method, payload });
        if (calls.length === 1) throw new Error('rich table rejected');
        return { message_id: 95 };
      }
    }
  };
  const markdown = '| Item | Value |\n|---|---|\n| A | B |';
  const result = await TelegramAIBot.prototype.trySendRichAssistantReply.call(fakeBot, ctx, markdown);
  assert.equal(result.layout, 'vertical');
  assert.equal(calls.length, 2);
  assert.match(calls[1].payload.rich_message.markdown, /### A/);
});

test('plain fallback converts markdown tables and HTML breaks into readable vertical text', () => {
  const plain = cleanBotOutput('| Direction | Progress |\n|---|---|\n| Models | Faster<br>Smarter |');
  assert.equal(plain, 'Models\nProgress：Faster；Smarter');
  assert.doesNotMatch(plain, /<br|^\|/m);
});

test('news renderer removes model-written references and keeps only verified source links', () => {
  const answer = [
    '今天新闻小结。',
    '',
    '## 参考来源',
    '1. 国药现代大宗交易分析',
    '2. 白宫发言人离职消息'
  ].join('\n');
  const raw = JSON.stringify({
    results: [
      { title: '东方财富报道', url: 'https://example.com/market', sourceName: '东方财富' },
      { title: '新唐人电视台报道', url: 'https://example.com/white-house', sourceName: '新唐人电视台' }
    ]
  });

  const markdown = formatNewsRichMarkdown(answer, raw, 'zh', 'Asia/Shanghai');

  assert.equal((markdown.match(/^## 参考来源$/gm) || []).length, 1);
  assert.match(markdown, /1\. \[东方财富｜东方财富报道\]\(https:\/\/example\.com\/market\)/);
  assert.match(markdown, /2\. \[新唐人电视台｜新唐人电视台报道\]\(https:\/\/example\.com\/white-house\)/);
  assert.doesNotMatch(markdown, /国药现代大宗交易分析|白宫发言人离职消息/);
});

test('news renderer converts only verified inline citations into Rich Message references', () => {
  const answer = [
    '第一条事实。[1]',
    '第二条事实【2】；无效编号不应保留。[9]',
    '',
    'Sources:',
    '1. 模型虚构的来源列表'
  ].join('\n');
  const raw = JSON.stringify({
    results: [
      { title: 'Source A', url: 'https://example.com/a' },
      { title: 'Source B', url: 'https://example.com/b' },
      { title: 'Unused Source', url: 'https://example.com/unused' }
    ]
  });

  const markdown = formatNewsRichMarkdown(answer, raw, 'zh', 'Asia/Shanghai');
  assert.match(markdown, /第一条事实。\[\^src1\]/);
  assert.match(markdown, /第二条事实\[\^src2\]/);
  assert.doesNotMatch(markdown, /\[9\]|虚构/);
  assert.match(markdown, /\[\^src1\]: \[Source A\]\(https:\/\/example\.com\/a\)/);
  assert.match(markdown, /\[\^src2\]: \[Source B\]\(https:\/\/example\.com\/b\)/);
  assert.doesNotMatch(markdown, /## 参考来源|Unused Source|example\.com\/unused/);
});

test('multiple verified citations stay adjacent for Telegram grouped source preview', () => {
  const raw = JSON.stringify({
    results: [
      { title: 'Source A', url: 'https://example.com/a' },
      { title: 'Source B', url: 'https://example.com/b' }
    ]
  });
  const markdown = formatNewsRichMarkdown('同一结论由两个来源支持。[1][2]', raw, 'zh', 'Asia/Shanghai');
  assert.match(markdown, /同一结论由两个来源支持。\[\^src1\]\[\^src2\]/);
  assert.equal((markdown.match(/^\[\^src\d+\]:/gm) || []).length, 2);
  assert.doesNotMatch(markdown, /## 参考来源/);
});

test('AI fallback retries another model for transient provider failures', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  const attempts = [];
  bot.config = {
    defaultModel: 'primary',
    translationModel: '',
    routerModel: '',
    availableModels: ['primary', 'backup']
  };
  bot.aiCooldowns = new Map();
  bot.logger = logger();
  bot.aiClient = {
    async completeWithTools({ model }) {
      attempts.push(model);
      if (model === 'primary') {
        throw new Error('AI request failed (503):');
      }
      return {
        text: 'backup ok',
        messages: [{ role: 'assistant', content: 'backup ok' }]
      };
    }
  };

  const completion = await bot.completeWithAiFallback({
    scope: 'chat',
    model: 'primary',
    request: { messages: [{ role: 'user', content: 'hi' }] }
  });

  assert.deepEqual(attempts, ['primary', 'backup']);
  assert.equal(completion.model, 'backup');
  assert.equal(completion.result.text, 'backup ok');
});

test('AI fallback skips unavailable models such as 404 responses', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  const attempts = [];
  bot.config = {
    defaultModel: 'retired-model',
    translationModel: '',
    routerModel: '',
    availableModels: ['retired-model', 'working-model']
  };
  bot.aiCooldowns = new Map();
  bot.logger = logger();
  bot.aiClient = {
    async completeWithTools({ model }) {
      attempts.push(model);
      if (model === 'retired-model') {
        throw new Error('AI request failed (404): model not found');
      }
      return { text: 'fallback ok', messages: [] };
    }
  };

  const completion = await bot.completeWithAiFallback({
    scope: 'chat',
    model: 'retired-model',
    request: { messages: [{ role: 'user', content: 'hello' }] }
  });

  assert.deepEqual(attempts, ['retired-model', 'working-model']);
  assert.equal(completion.model, 'working-model');
  assert.equal(completion.result.text, 'fallback ok');
});

test('AI fallback retries when a provider returns an empty result', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  const attempts = [];
  bot.config = {
    defaultModel: 'empty-model',
    translationModel: '',
    routerModel: '',
    availableModels: ['empty-model', 'working-model']
  };
  bot.aiCooldowns = new Map();
  bot.logger = logger();
  bot.aiClient = {
    async completeWithTools({ model }) {
      attempts.push(model);
      return model === 'empty-model'
        ? { text: '', messages: [] }
        : { text: 'non-empty fallback', messages: [] };
    }
  };

  const completion = await bot.completeWithAiFallback({
    scope: 'chat',
    model: 'empty-model',
    request: { messages: [{ role: 'user', content: 'hello' }] }
  });

  assert.deepEqual(attempts, ['empty-model', 'working-model']);
  assert.equal(completion.model, 'working-model');
});

test('empty AI results normalize instead of crashing text/message consumers', () => {
  const bot = Object.create(TelegramAIBot.prototype);
  const fallbackMessages = [{ role: 'user', content: 'hello' }];
  const result = bot.normalizeAiResult(undefined, fallbackMessages);

  assert.equal(result.text, '');
  assert.equal(result.messages, fallbackMessages);
});

test('toolbox exposes real feature callbacks and unknown buttons get a visible fallback', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { miniAppEnabled: false };
  bot.logger = logger();
  bot.getLocale = () => 'en';
  bot.createMenuKeyboard = () => ({ reply_markup: { inline_keyboard: [] } });

  const keyboard = TelegramAIBot.prototype.createToolboxKeyboard.call(bot, 'en').reply_markup.inline_keyboard;
  const callbacks = keyboard.flat().map((button) => button.callback_data);
  assert.ok(callbacks.includes('toolbox:web'));
  assert.ok(callbacks.includes('toolbox:translate'));
  assert.ok(callbacks.includes('toolbox:back'));

  const answers = [];
  const replies = [];
  await bot.handleUnknownCallback({
    chat: { id: 1 },
    from: { language_code: 'en' },
    callbackQuery: { data: 'old:button' },
    answerCbQuery: async (message) => answers.push(message),
    reply: async (message, extra) => replies.push({ message, extra })
  });

  assert.match(answers[0], /no longer available/i);
  assert.match(replies[0].message, /open the menu/i);
});

test('persona settings open from a callback without a message payload', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.db = {
    findUser() {
      return { persona: 'coder' };
    }
  };
  bot.getLocale = () => 'zh';

  const replies = [];
  await bot.handlePersona({
    from: { id: 1 },
    reply: async (message, extra) => replies.push({ message, extra })
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0].message, /当前：coder/);
});

test('opening the main menu does not send a shortcut status message', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { miniAppEnabled: false };
  bot.getLocale = () => 'zh';
  bot.t = () => '请选择功能：';
  bot.createMenuKeyboard = () => ({ reply_markup: { inline_keyboard: [] } });

  const replies = [];
  await bot.handleMenu({
    reply: async (message, extra) => replies.push({ message, extra })
  });

  assert.deepEqual(replies.map((item) => item.message), ['请选择功能：']);
  assert.doesNotMatch(replies[0].message, /快捷键已开启/);
});

test('free web search fallback returns real HTML search results', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /html\.duckduckgo\.com\/html/);
    return {
      ok: true,
      status: 200,
      async text() {
        return `
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews">Current news result</a>
          <a class="result__snippet">A current news summary with useful details.</a>
        `;
      }
    };
  };

  try {
    const registry = new ToolRegistry({
      ...toolConfig(),
      enableWebSearch: true,
      toolAllowedNames: new Set(['web_search'])
    }, logger());
    const raw = await registry.execute({
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'current news' }) }
    }, {
      userId: '1',
      chatId: '2',
      toolUsage: { count: 0 }
    });
    const result = JSON.parse(raw);

    assert.equal(result.provider, 'duckduckgo');
    assert.equal(result.results[0].title, 'Current news result');
    assert.equal(result.results[0].url, 'https://example.com/news');
    assert.match(result.results[0].snippet, /useful details/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('localized slash commands stay minimal and refresh per chat', async () => {
  const calls = [];
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { miniAppEnabled: false };
  bot.logger = logger();
  bot.bot = {
    telegram: {
      async setMyCommands(commands, options = {}) {
        calls.push({ commands, options });
      }
    }
  };

  await bot.setLocalizedBotCommands();
  const indonesian = calls.find((item) => item.options.language_code === 'id');
  const dutch = calls.find((item) => item.options.language_code === 'nl');
  assert.ok(indonesian);
  assert.ok(dutch);
  assert.deepEqual(
    indonesian.commands.map((item) => item.command),
    ['start', 'menu', 'help', 'reset', 'whoami']
  );
  assert.ok(!indonesian.commands.some((item) => item.command === 'language'));
  assert.ok(!indonesian.commands.some((item) => item.command === 'web'));

  await bot.setChatBotCommands({ chat: { id: 99 } }, 'zh-hant');
  const chatCall = calls.at(-1);
  assert.deepEqual(chatCall.options.scope, { type: 'chat', chat_id: 99 });
  assert.equal(chatCall.commands.find((item) => item.command === 'reset').description, '清除目前對話');
});

test('Mini App mode exposes start help and whoami commands', async () => {
  const calls = [];
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { miniAppEnabled: true };
  bot.logger = logger();
  bot.bot = {
    telegram: {
      async setMyCommands(commands, options = {}) {
        calls.push({ commands, options });
      }
    }
  };

  await bot.setLocalizedBotCommands();
  assert.deepEqual(calls[0].commands.map((item) => item.command), ['start', 'help', 'whoami']);
});

test('Telegram command rate limits do not crash startup or repeat localized requests', async () => {
  const warnings = [];
  let calls = 0;
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { miniAppEnabled: true };
  bot.logger = {
    warn(message, meta) { warnings.push({ message, meta }); }
  };
  bot.bot = {
    telegram: {
      async setMyCommands() {
        calls += 1;
        const error = new Error('Too Many Requests: retry after 1275');
        error.response = { parameters: { retry_after: 1275 } };
        throw error;
      }
    }
  };

  assert.equal(await bot.setLocalizedBotCommands(), false);
  assert.equal(calls, 1);
  assert.equal(warnings[0].meta.retryAfter, 1275);
  assert.match(warnings[0].message, /startup will continue/);
});

test('stopping a Telegram bot that never launched is an idempotent no-op', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.logger = { info() {} };
  bot.usageReservationSweepTimer = null;
  bot.bot = {
    stop() { throw new Error('Bot is not running!'); }
  };

  assert.equal(await bot.stop('INITIALIZATION_FAILED'), false);
});

test('Telegram launch reuses the getMe result already verified during init', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  const verifiedBotInfo = { id: 123, username: 'MainTestBot', is_bot: true };
  let ready = 0;
  let botInfoAtLaunch = null;
  bot.botInfo = verifiedBotInfo;
  bot.logger = logger();
  bot.bot = {
    botInfo: null,
    async launch(onLaunch) {
      botInfoAtLaunch = this.botInfo;
      onLaunch?.();
    }
  };

  await bot.launch(() => { ready += 1; });

  assert.equal(botInfoAtLaunch, verifiedBotInfo);
  assert.equal(ready, 1);
});

test('Telegram bot sweeps expired in-memory interaction state without touching active entries', () => {
  const bot = Object.create(TelegramAIBot.prototype);
  const now = Date.now();
  bot.config = { rateLimitWindowMs: 60_000 };
  bot.pendingMenuActions = new Map([
    ['expired', { createdAt: now - 6 * 60_000 }],
    ['active', { createdAt: now - 30_000 }]
  ]);
  bot.activeModes = new Map([
    ['expired', { createdAt: now - 25 * 60 * 60_000 }],
    ['active', { createdAt: now - 25 * 60 * 60_000, updatedAt: now - 1_000 }]
  ]);
  bot.assistantActionStates = new Map([
    ['expired-token', { chatId: 1, messageId: 2, createdAt: now - 25 * 60 * 60_000 }],
    ['active-token', { chatId: 1, messageId: 3, createdAt: now - 1_000 }]
  ]);
  bot.assistantActionStatesByMessage = new Map([
    ['1:2', 'expired-token'],
    ['1:3', 'active-token'],
    ['1:4', 'dangling-token']
  ]);
  bot.richReplyContexts = new Map([
    ['1:5', { text: 'expired rich reply', createdAt: now - 25 * 60 * 60_000 }],
    ['1:6', { text: 'active rich reply', createdAt: now - 1_000 }]
  ]);
  bot.aiCooldowns = new Map([
    ['expired', now - 1],
    ['active', now + 10_000]
  ]);
  bot.rateLimits = new Map([
    ['expired', [now - 61_000]],
    ['active', [now - 1_000]]
  ]);

  const removed = bot.sweepEphemeralState(now);

  assert.deepEqual(removed, {
    pendingMenuActions: 1,
    activeModes: 1,
    assistantActions: 1,
    richReplyContexts: 1,
    aiCooldowns: 1,
    rateLimits: 1
  });
  assert.deepEqual([...bot.pendingMenuActions.keys()], ['active']);
  assert.deepEqual([...bot.activeModes.keys()], ['active']);
  assert.deepEqual([...bot.assistantActionStates.keys()], ['active-token']);
  assert.deepEqual([...bot.assistantActionStatesByMessage.keys()], ['1:3']);
  assert.deepEqual([...bot.richReplyContexts.keys()], ['1:6']);
  assert.deepEqual([...bot.aiCooldowns.keys()], ['active']);
  assert.deepEqual([...bot.rateLimits.keys()], ['active']);
});

test('Mini App mode does not duplicate the BotFather Console entry', () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { miniAppEnabled: true };

  assert.equal(bot.createBottomKeyboard('zh')?.reply_markup?.remove_keyboard, true);
  assert.equal(bot.createMenuKeyboard('zh'), undefined);
  assert.doesNotMatch(bot.registerCommands.toString(), /command\('app'/);
  assert.doesNotMatch(bot.init.toString(), /setChatMenuButton|configureMiniAppMenuButton/);
  assert.match(bot.handleIncomingMessage.toString(), /miniAppEnabled === false/);
});

test('Mini App mode keeps private chat plus the two required billing entries in the bottom keyboard', async () => {
  const bot = Object.create(PrivacyTelegramAIBot.prototype);
  bot.config = { miniAppEnabled: true, maxOutputChars: 3500 };
  bot.getLocale = () => 'zh';

  const keyboard = bot.createBottomKeyboard('zh');
  assert.deepEqual(keyboard.reply_markup.keyboard, [
    [bot.getPrivacyLabel('zh')],
    ['⭐ 购买额度', '💰 我的余额']
  ]);
  assert.equal(keyboard.reply_markup.is_persistent, true);
  assert.equal(bot.createEssentialMenuKeyboard('zh'), undefined);
  assert.equal(bot.createToolboxKeyboard('zh'), undefined);
  assert.match(bot.handleBottomKeyboardAction.toString(), /隐私聊天/);
  assert.match(TelegramAIBot.prototype.handleStart.toString(), /createBottomKeyboard/);
  assert.match(TelegramAIBot.prototype.handleHelp.toString(), /createBottomKeyboard/);
  assert.match(TelegramAIBot.prototype.handleToolboxCallback.toString(), /miniAppEnabled !== false/);

  const replies = [];
  const ctx = {
    reply: async (message, extra) => replies.push({ message, extra })
  };
  await bot.handleStart(ctx);
  await bot.handleHelp(ctx);

  assert.equal(replies.length, 2);
  assert.deepEqual(replies[0].extra.reply_markup.keyboard, keyboard.reply_markup.keyboard);
  assert.deepEqual(replies[1].extra.reply_markup.keyboard, keyboard.reply_markup.keyboard);
  assert.doesNotMatch(replies.map((item) => item.message).join('\n'), /工具箱|联网搜索、翻译、图片/);
  assert.match(replies[1].message, /\/whoami/);
  assert.match(replies[1].message, /局部引用/);
});

test('privacy chat checks the shared account quota before calling AI', async () => {
  const bot = Object.create(PrivacyTelegramAIBot.prototype);
  bot.config = { maxInputChars: 4000 };
  bot.privacyConfig = { maxSessionMessages: 10 };
  bot.getLocale = () => 'zh';
  bot.isAllowed = () => true;
  bot.checkRateLimit = () => true;
  let quotaChecks = 0;
  let aiCalls = 0;
  bot.consumeQuotaForContext = async () => {
    quotaChecks += 1;
    return false;
  };
  bot.completeWithAiFallback = async () => {
    aiCalls += 1;
    return { result: { text: 'must not run' } };
  };

  const handled = await bot.handleActiveMode({
    from: { id: 1 },
    chat: { id: 1, type: 'private' },
    message: { text: 'private question' },
    reply: async () => undefined
  }, {
    type: 'privacy',
    contextMode: 'temporary',
    messages: [],
    messageCount: 0,
    expiresAt: Date.now() + 60000
  });

  assert.equal(handled, true);
  assert.equal(quotaChecks, 1);
  assert.equal(aiCalls, 0);
});

test('privacy chat refunds a reserved quota when AI fails', async () => {
  const bot = Object.create(PrivacyTelegramAIBot.prototype);
  bot.config = { maxInputChars: 4000, defaultModel: 'test-model' };
  bot.privacyConfig = {
    maxSessionMessages: 10,
    maxContextMessages: 6,
    maxContextChars: 12000,
    ttlMs: 60000
  };
  bot.logger = logger();
  bot.getLocale = () => 'zh';
  bot.consumeQuotaForContext = async () => true;
  let refunds = 0;
  bot.refundQuotaForContext = async () => {
    refunds += 1;
    return true;
  };
  bot.db = { findUser: () => ({}) };
  bot.getEffectiveAISettings = () => ({ providerId: 'gemini', modelId: 'test-model' });
  bot.completeWithAiFallback = async () => {
    throw new Error('provider failed');
  };
  bot.formatUserFacingError = () => 'failed';
  bot.createPrivacyModeKeyboard = () => undefined;

  const replies = [];
  const handled = await bot.handleActiveMode({
    from: { id: 1 },
    chat: { id: 1, type: 'private' },
    message: { text: 'private question' },
    sendChatAction: async () => undefined,
    reply: async (message) => replies.push(message)
  }, {
    type: 'privacy',
    contextMode: 'temporary',
    messages: [],
    messageCount: 0,
    expiresAt: Date.now() + 60000
  });

  assert.equal(handled, true);
  assert.equal(refunds, 1);
  assert.deepEqual(replies, ['failed']);
});

test('assistant translate and regenerate actions refund empty AI results', async (t) => {
  for (const action of ['translate_pick', 'regen']) {
    await t.test(action, async () => {
      const bot = Object.create(TelegramAIBot.prototype);
      bot.config = { defaultModel: 'test-model', translationModel: 'translation-model' };
      bot.getLocale = () => 'zh';
      bot.getAssistantActionStateByToken = () => ({
        userId: 1,
        locale: 'zh',
        model: 'test-model',
        replyText: 'original'
      });
      bot.getAiCooldown = () => null;
      bot.consumeQuotaForContext = async () => true;
      let refunds = 0;
      bot.refundQuotaForContext = async () => {
        refunds += 1;
        return true;
      };
      bot.translateAssistantReply = async () => '';
      bot.regenerateAssistantReply = async () => ({ text: '' });
      bot.t = (_locale, key) => key;
      bot.db = { findUser: () => ({ preferredModel: 'test-model' }) };

      const answers = [];
      const replies = [];
      await bot.handleAssistantActionCallback({
        callbackQuery: {
          data: action === 'translate_pick'
            ? 'act:translate_pick:token:en'
            : 'act:regen:token'
        },
        from: { id: 1 },
        answerCbQuery: async (message) => answers.push(message),
        reply: async (message) => replies.push(message)
      });

      assert.deepEqual(answers, ['actionWorking']);
      assert.deepEqual(replies, ['noReply']);
      assert.equal(refunds, 1);
    });
  }
});

test('assistant actions refund a reserved credit when Telegram cannot edit the delivered message', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { defaultModel: 'test-model', translationModel: 'translation-model' };
  bot.logger = logger();
  bot.getLocale = () => 'en';
  bot.getAssistantActionStateByToken = () => ({
    userId: 1,
    locale: 'en',
    model: 'test-model',
    replyText: 'original'
  });
  bot.getAiCooldown = () => null;
  bot.consumeQuotaForContext = async () => true;
  let refunds = 0;
  bot.refundQuotaForContext = async () => {
    refunds += 1;
    return true;
  };
  bot.translateAssistantReply = async () => 'translated';
  bot.createAssistantActionKeyboard = () => undefined;
  bot.editAssistantMessageText = async () => {
    throw new Error('message is not editable');
  };
  bot.isAiQuotaError = () => false;
  bot.formatLogError = (error) => ({ detail: error.message });
  bot.formatUserFacingError = (error) => error.message;
  bot.t = (_locale, key) => key;

  const answers = [];
  await bot.handleAssistantActionCallback({
    callbackQuery: { data: 'act:translate_pick:token:en' },
    from: { id: 1 },
    answerCbQuery: async (message) => answers.push(message),
    reply: async () => undefined
  });

  assert.equal(refunds, 1);
  assert.deepEqual(answers, ['actionWorking', 'message is not editable']);
});

test('natural weather tool failures are visible and do not consume quota', async () => {
  let refunds = 0;
  let toolStats = 0;
  const replies = [];
  const bot = {
    config: { maxOutputChars: 3500 },
    db: {
      async incrementStats() { toolStats += 1; }
    },
    toolRegistry: {
      async execute() {
        return JSON.stringify({ error: 'fetch failed', message: 'fetch failed' });
      }
    },
    getLocale: () => 'en',
    isAdmin: () => false,
    consumeQuotaForContext: async () => true,
    refundQuotaForContext: async () => { refunds += 1; }
  };

  const handled = await tryHandleNaturalAgent(bot, {
    from: { id: 1 },
    chat: { id: 1 },
    message: { text: 'weather Paris' },
    reply: async (message) => replies.push(message)
  });

  assert.equal(handled, true);
  assert.equal(refunds, 1);
  assert.equal(toolStats, 0);
  assert.deepEqual(replies, ['Weather is not available yet.']);
});

test('empty URL fetch results are visible and do not consume quota', async (t) => {
  await t.test('direct URL action', async () => {
    const bot = Object.create(TelegramAIBot.prototype);
    bot.config = { maxOutputChars: 3500 };
    bot.getLocale = () => 'en';
    bot.isAdmin = () => false;
    bot.consumeQuotaForContext = async () => true;
    let refunds = 0;
    let toolStats = 0;
    bot.refundQuotaForContext = async () => { refunds += 1; };
    bot.toolRegistry = { execute: async () => '' };
    bot.db = { incrementStats: async () => { toolStats += 1; } };
    const replies = [];

    await bot.runUrlFetch({
      from: { id: 1 },
      chat: { id: 1 },
      sendChatAction: async () => undefined,
      reply: async (message) => replies.push(message)
    }, 'https://example.com/empty');

    assert.equal(refunds, 1);
    assert.equal(toolStats, 0);
    assert.deepEqual(replies, ['This page returned no readable content.']);
  });

  await t.test('natural URL action', async () => {
    let refunds = 0;
    let toolStats = 0;
    const replies = [];
    const bot = {
      config: { maxOutputChars: 3500 },
      db: { incrementStats: async () => { toolStats += 1; } },
      toolRegistry: { execute: async () => '' },
      getLocale: () => 'en',
      isAdmin: () => false,
      consumeQuotaForContext: async () => true,
      refundQuotaForContext: async () => { refunds += 1; }
    };

    const handled = await tryHandleNaturalAgent(bot, {
      from: { id: 1 },
      chat: { id: 1 },
      message: { text: 'https://example.com/empty' },
      sendChatAction: async () => undefined,
      reply: async (message) => replies.push(message)
    });

    assert.equal(handled, true);
    assert.equal(refunds, 1);
    assert.equal(toolStats, 0);
    assert.deepEqual(replies, ['This page returned no readable content.']);
  });
});

test('nonempty generic JSON URL results continue through composition', async (t) => {
  await t.test('direct URL action', async () => {
    const bot = Object.create(TelegramAIBot.prototype);
    bot.config = { maxOutputChars: 3500 };
    bot.getLocale = () => 'en';
    bot.isAdmin = () => false;
    bot.consumeQuotaForContext = async () => true;
    let refunds = 0;
    let toolStats = 0;
    bot.refundQuotaForContext = async () => { refunds += 1; };
    bot.toolRegistry = { execute: async () => JSON.stringify({ foo: 'bar' }) };
    bot.db = { incrementStats: async () => { toolStats += 1; } };
    bot.composeToolReply = async () => ({ text: 'JSON summary', html: false });
    const replies = [];

    await bot.runUrlFetch({
      from: { id: 1 },
      chat: { id: 1 },
      sendChatAction: async () => undefined,
      reply: async (message) => replies.push(message)
    }, 'https://example.com/json');

    assert.equal(refunds, 0);
    assert.equal(toolStats, 1);
    assert.deepEqual(replies, ['JSON summary']);
  });

  await t.test('natural URL action', async () => {
    let refunds = 0;
    let toolStats = 0;
    const replies = [];
    const bot = {
      config: { maxOutputChars: 3500 },
      db: {
        findUser: () => ({}),
        incrementStats: async () => { toolStats += 1; }
      },
      toolRegistry: { execute: async () => JSON.stringify({ foo: 'bar' }) },
      getLocale: () => 'en',
      isAdmin: () => false,
      consumeQuotaForContext: async () => true,
      refundQuotaForContext: async () => { refunds += 1; },
      completeWithAiFallback: async () => ({ result: { text: 'JSON summary' } })
    };

    const handled = await tryHandleNaturalAgent(bot, {
      from: { id: 1 },
      chat: { id: 1 },
      message: { text: 'https://example.com/json' },
      sendChatAction: async () => undefined,
      reply: async (message) => replies.push(message)
    });

    assert.equal(handled, true);
    assert.equal(refunds, 0);
    assert.equal(toolStats, 1);
    assert.deepEqual(replies, ['JSON summary']);
  });
});

test('admin provider test refunds when the result cannot be delivered', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { defaultModel: 'test-model' };
  bot.getLocale = () => 'en';
  bot.isAdmin = () => true;
  bot.consumeQuotaForContext = async () => true;
  let refunds = 0;
  bot.refundQuotaForContext = async () => { refunds += 1; };
  bot.providerManager = {
    listProviders: () => [{
      id: 'gemini',
      name: 'Gemini',
      configured: true,
      enabled: true,
      models: ['test-model']
    }]
  };
  bot.completeWithAiFallback = async () => ({ model: 'test-model', result: { text: 'AI_OK' } });
  bot.createAdminActionKeyboard = () => undefined;

  await assert.rejects(() => bot.handleAdminProviderTestAll({
    reply: async () => { throw new Error('delivery failed'); }
  }), /delivery failed/);
  assert.equal(refunds, 1);
});

test('quoted reply preparation keeps the selected passage in the same conversation request', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = { maxInputChars: 4000 };
  bot.getLocale = () => 'zh';

  const prepared = await bot.prepareUserMessage({
    message: {
      text: '这条为什么重要？',
      message_thread_id: 123,
      is_topic_message: false,
      quote: { text: '新的政策将在下月生效' },
      reply_to_message: {
        message_id: 88,
        text: '这是机器人此前输出的完整新闻摘要。新的政策将在下月生效。',
        from: { is_bot: true }
      }
    }
  });

  assert.equal(prepared.message.role, 'user');
  assert.match(prepared.message.content, /新的政策将在下月生效/);
  assert.match(prepared.message.content, /这条为什么重要/);
  assert.match(prepared.message.content, /Do not start a new topic/);
  assert.match(TelegramAIBot.prototype.handleIncomingMessage.toString(), /isReplyToCurrentBot/);
  assert.match(TelegramAIBot.prototype.handleIncomingMessage.toString(), /botUserId/);
});

test('search replies hide naked source URLs behind clickable titles', async () => {
  const replies = [];
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = {
    aiProvider: 'gemini',
    enableWebSearch: true,
    enableGeminiGoogleSearch: true,
    defaultModel: 'gemini-2.5-flash',
    availableModels: ['gemini-2.5-flash'],
    maxOutputChars: 3500
  };
  bot.logger = logger();
  bot.db = {
    findUser() {
      return { preferredModel: 'gemini-2.5-flash', preferredLanguage: 'zh' };
    },
    async incrementStats() {}
  };
  bot.aiClient = {
    async searchWeb() {
      return {
        text: '今天的重要新闻摘要。\n\nSources:\n1. Example News — https://example.com/current-news'
      };
    }
  };

  await bot.runWebSearch({
    from: { id: 1, language_code: 'zh' },
    chat: { id: 1, type: 'private' },
    message: { message_id: 10, text: 'latest AI developments' },
    async sendChatAction() {},
    async reply(message, extra) {
      replies.push({ message, extra });
    }
  }, 'latest AI developments');

  assert.equal(replies.length, 1);
  assert.equal(replies[0].extra.parse_mode, 'HTML');
  assert.match(replies[0].message, /<a href="https:\/\/example\.com\/current-news">Example News<\/a>/);
  assert.doesNotMatch(replies[0].message.replace(/href="[^"]+"/g, ''), /https:\/\//);
});

test('direct today-news search uses dated RSS before the failing generic search tool', async () => {
  const replies = [];
  const richCalls = [];
  const requested = [];
  let genericSearchCalls = 0;
  let refunds = 0;
  const originalNewsFallback = naturalAgentInternals.fetchNewsFallback;
  naturalAgentInternals.fetchNewsFallback = async (query, options) => {
    requested.push({ query, options });
    return JSON.stringify({
      strictToday: true,
      timeZone: 'Asia/Shanghai',
      results: [{
        title: '今天发布的重要新闻',
        description: '示例通讯社 · 2026/07/29 12:00',
        url: 'https://example.com/today-news',
        sourceName: '示例通讯社',
        publishedAt: '2026-07-29T04:00:00.000Z'
      }]
    });
  };

  try {
    const bot = Object.create(TelegramAIBot.prototype);
    bot.config = {
      aiProvider: 'openai-compatible',
      enableWebSearch: true,
      enableGeminiGoogleSearch: false,
      defaultModel: 'gpt-5-mini',
      maxHistoryMessages: 20,
      maxOutputChars: 3500,
      requestTimeoutMs: 120000,
      enableRichMessages: true,
      richMessageMinChars: 600,
      newsRegion: 'MY',
      newsLanguage: 'auto',
      newsTimeZone: 'Asia/Kuala_Lumpur'
    };
    bot.logger = logger();
    bot.db = {
      findUser() {
        return { preferredLanguage: 'zh', persona: 'default' };
      },
      getUserNewsSettings() {
        return {
          region: 'CN',
          language: 'zh-CN',
          timeZone: 'Asia/Shanghai'
        };
      },
      getConversation() {
        return [];
      },
      async setConversation() {},
      async incrementStats() {}
    };
    bot.toolRegistry = {
      async execute() {
        genericSearchCalls += 1;
        return JSON.stringify({
          ok: false,
          error: 'TOOL_EXECUTION_FAILED',
          message: 'The tool could not complete the request. Try another available approach or explain the limitation.'
        });
      }
    };
    bot.getLocale = () => 'zh';
    bot.getEffectiveAISettings = () => ({
      providerId: 'openai-compatible',
      modelId: 'gpt-5-mini',
      autoRouting: true,
      fallbackEnabled: true
    });
    bot.resolveSmartModelRoute = () => ({
      provider: 'openai-compatible',
      model: 'gpt-5-mini'
    });
    bot.consumeQuotaForContext = async () => true;
    bot.refundQuotaForContext = async () => {
      refunds += 1;
    };
    bot.completeWithAiFallback = async () => ({
      result: { text: '这是今天已核实的一条重要新闻摘要。' }
    });

    await bot.runWebSearch({
      from: { id: 1, language_code: 'zh' },
      chat: { id: 1, type: 'private' },
      message: { message_id: 10, text: '今日新闻' },
      telegram: {
        async callApi(method, payload) {
          richCalls.push({ method, payload });
          return { message_id: 88 };
        }
      },
      async sendChatAction() {},
      async reply(message, extra) {
        replies.push({ message, extra });
      }
    }, '今日新闻');
  } finally {
    naturalAgentInternals.fetchNewsFallback = originalNewsFallback;
  }

  assert.equal(requested.length, 1);
  assert.equal(requested[0].query, '今日新闻');
  assert.equal(requested[0].options.todayOnly, true);
  assert.equal(requested[0].options.region, 'CN');
  assert.equal(requested[0].options.timeZone, 'Asia/Shanghai');
  assert.equal(genericSearchCalls, 0);
  assert.equal(refunds, 0);
  assert.equal(replies.length, 0);
  assert.equal(richCalls.length, 1);
  assert.equal(richCalls[0].method, 'sendRichMessage');
  assert.match(richCalls[0].payload.rich_message.markdown, /^# 今日新闻/m);
  assert.match(richCalls[0].payload.rich_message.markdown, /这是今天已核实的一条重要新闻摘要/);
  assert.match(richCalls[0].payload.rich_message.markdown, /示例通讯社/);
  assert.match(richCalls[0].payload.rich_message.markdown, /https:\/\/example\.com\/today-news/);
  assert.doesNotMatch(
    richCalls[0].payload.rich_message.markdown,
    /TOOL_EXECUTION_FAILED|The tool could not complete|处理失败/
  );
});

test('model-initiated news tools keep personal news settings for follow-up wording', async () => {
  const originalNewsFallback = naturalAgentInternals.fetchNewsFallback;
  let received;
  let newsCalls = 0;
  naturalAgentInternals.fetchNewsFallback = async (query, options) => {
    newsCalls += 1;
    received = { query, options };
    return JSON.stringify({
      strictToday: true,
      results: [{ title: 'Follow-up headline', url: 'https://example.com/follow-up' }]
    });
  };

  try {
    const bot = Object.create(TelegramAIBot.prototype);
    bot.config = {
      requestTimeoutMs: 4000,
      newsRegion: 'MY',
      newsLanguage: 'auto',
      newsTimeZone: 'Asia/Kuala_Lumpur'
    };
    bot.logger = logger();
    bot.formatLogError = (error) => ({ detail: String(error?.message || error) });
    bot.db = {
      getUserNewsSettings() {
        return {
          region: 'US',
          language: 'en-US',
          timeZone: 'America/New_York'
        };
      }
    };

    const result = await bot.searchPersonalizedNewsForTool('再找几条今天的', {
      userId: 7,
      locale: 'zh',
      telegramLanguageCode: 'zh-CN',
      forceNews: true
    });

    assert.equal(result.handled, true);
    assert.match(result.output, /Follow-up headline/);
    assert.equal(received.query, '再找几条今天的');
    assert.equal(received.options.region, 'US');
    assert.equal(received.options.language, 'en-US');
    assert.equal(received.options.timeZone, 'America/New_York');
    assert.equal(received.options.todayOnly, true);

    const unrelated = await bot.searchPersonalizedNewsForTool('USD exchange rate', {
      userId: 7,
      locale: 'zh',
      forceNews: true
    });
    assert.equal(unrelated.handled, false);

    for (const query of [
      'more information about Acme',
      '再查这家公司背景',
      '再查黄金走势'
    ]) {
      const nonNewsFollowUp = await bot.searchPersonalizedNewsForTool(query, {
        userId: 7,
        locale: 'zh',
        forceNews: true
      });
      assert.equal(nonNewsFollowUp.handled, false, `${query} must stay a generic web search`);
    }
    assert.equal(newsCalls, 1);

    const developmentFollowUp = await bot.searchPersonalizedNewsForTool(
      'latest developments about Acme',
      {
        userId: 7,
        locale: 'en',
        forceNews: true
      }
    );
    assert.equal(developmentFollowUp.handled, true);
    assert.equal(newsCalls, 2);
  } finally {
    naturalAgentInternals.fetchNewsFallback = originalNewsFallback;
  }
});

test('direct today-news search never leaks internal tool errors when dated news is unavailable', async () => {
  const replies = [];
  let genericSearchCalls = 0;
  let refunds = 0;
  const originalNewsFallback = naturalAgentInternals.fetchNewsFallback;
  naturalAgentInternals.fetchNewsFallback = async () => '';

  try {
    const bot = Object.create(TelegramAIBot.prototype);
    bot.config = {
      aiProvider: 'openai-compatible',
      enableWebSearch: true,
      enableGeminiGoogleSearch: false,
      defaultModel: 'gpt-5-mini',
      maxOutputChars: 3500,
      requestTimeoutMs: 120000,
      newsRegion: 'CN',
      newsLanguage: 'zh-CN',
      newsTimeZone: 'Asia/Shanghai',
      adminUserIds: new Set()
    };
    bot.logger = logger();
    bot.db = {
      findUser() {
        return { preferredLanguage: 'zh' };
      }
    };
    bot.toolRegistry = {
      async execute() {
        genericSearchCalls += 1;
        return JSON.stringify({
          ok: false,
          error: 'TOOL_EXECUTION_FAILED',
          message: 'The tool could not complete the request. Try another available approach or explain the limitation.'
        });
      }
    };
    bot.getLocale = () => 'zh';
    bot.getEffectiveAISettings = () => ({
      providerId: 'openai-compatible',
      modelId: 'gpt-5-mini',
      autoRouting: true,
      fallbackEnabled: true
    });
    bot.resolveSmartModelRoute = () => ({
      provider: 'openai-compatible',
      model: 'gpt-5-mini'
    });
    bot.consumeQuotaForContext = async () => true;
    bot.refundQuotaForContext = async () => {
      refunds += 1;
    };

    await bot.runWebSearch({
      from: { id: 1, language_code: 'zh' },
      chat: { id: 1, type: 'private' },
      message: { message_id: 10, text: '今日新闻' },
      async sendChatAction() {},
      async reply(message, extra) {
        replies.push({ message, extra });
      }
    }, '今日新闻');
  } finally {
    naturalAgentInternals.fetchNewsFallback = originalNewsFallback;
  }

  assert.equal(genericSearchCalls, 1);
  assert.equal(refunds, 1);
  assert.equal(replies.length, 1);
  assert.match(replies[0].message, /暂未找到可验证为今天发布的新闻/);
  assert.doesNotMatch(
    replies[0].message,
    /TOOL_EXECUTION_FAILED|The tool could not complete|Try another available approach|处理失败/
  );
});

test('capability provider selection stays request-scoped during overlapping requests', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  const initialClient = { id: 'initial' };
  const clientA = { id: 'a' };
  const clientB = { id: 'b' };
  bot.aiClient = initialClient;
  bot.activeServiceProvider = 'initial';
  bot.multimodalActions = { aiClient: initialClient };
  bot.audioOrchestrator = { aiClient: initialClient };
  bot.providerManager = {
    selectProvider({ preferredProvider }) {
      const client = preferredProvider === 'a' ? clientA : clientB;
      return {
        providerId: preferredProvider,
        providerName: preferredProvider.toUpperCase(),
        client,
        capabilities: { imageGeneration: true }
      };
    }
  };

  let releaseA;
  let releaseB;
  const waitA = new Promise((resolve) => { releaseA = resolve; });
  const waitB = new Promise((resolve) => { releaseB = resolve; });

  const requestA = bot.withProviderForCapability('imageGeneration', 'a', async (selected) => {
    assert.equal(selected.client, clientA);
    await waitA;
    return selected.providerId;
  });
  const requestB = bot.withProviderForCapability('imageGeneration', 'b', async (selected) => {
    assert.equal(selected.client, clientB);
    await waitB;
    return selected.providerId;
  });

  assert.equal(bot.aiClient, initialClient);
  assert.equal(bot.multimodalActions.aiClient, initialClient);
  assert.equal(bot.audioOrchestrator.aiClient, initialClient);

  releaseA();
  assert.equal(await requestA, 'a');
  assert.equal(bot.aiClient, initialClient);
  releaseB();
  assert.equal(await requestB, 'b');
  assert.equal(bot.aiClient, initialClient);
  assert.equal(bot.activeServiceProvider, 'initial');
});

test('unavailable capability provider does not silently use the default client', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
  bot.providerManager = { selectProvider: () => null };
  let callbackCalled = false;

  const result = await bot.withProviderForCapability('imageGeneration', 'missing', async () => {
    callbackCalled = true;
    return { ok: true };
  });

  assert.equal(callbackCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROVIDER_UNAVAILABLE');
});

test('media services use the request-scoped provider client and avoid duplicate live retries', async () => {
  const stats = [];
  const db = { incrementStats: async (name) => stats.push(name) };
  const silentLogger = logger();
  const defaultClient = {
    async generateImage() { throw new Error('default image client used'); },
    async generateSpeech() { throw new Error('default speech client used'); }
  };

  const images = new MultimodalActionService({
    aiClient: defaultClient,
    db,
    logger: silentLogger,
    getProviderCapabilities: () => ({ imageGeneration: false }),
    getProviderName: () => 'default'
  });
  const imageResult = await images.runImageAction({
    mode: 'generate',
    prompt: 'test',
    aiClient: { async generateImage() { return { data: [{ url: 'https://example.com/image.png' }] }; } },
    capabilities: { imageGeneration: true },
    providerName: 'request-provider'
  });
  assert.equal(imageResult.ok, true);

  let speechCalls = 0;
  const audio = new AudioOrchestrator({
    config: { enableLiveAudio: true },
    aiClient: defaultClient,
    db,
    logger: silentLogger,
    getProviderCapabilities: () => ({ speechSynthesis: false }),
    getProviderName: () => 'default'
  });
  const speechResult = await audio.textToSpeech({
    input: 'hello',
    aiClient: {
      async generateSpeech() {
        speechCalls += 1;
        throw new Error('request failed');
      }
    },
    capabilities: { liveAudio: true, speechSynthesis: true },
    providerName: 'request-provider'
  });

  assert.equal(speechResult.ok, false);
  assert.equal(speechCalls, 1);
  assert.deepEqual(stats, ['aiCalls', 'imageGenerations']);
});
