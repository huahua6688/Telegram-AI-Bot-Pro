import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformModesTelegramAIBot, platformModesInternals } from '../src/services/platform-modes-telegram-bot.js';
import { naturalAgentInternals } from '../src/services/natural-agent.js';

function createBot(overrides = {}) {
  const bot = Object.create(PlatformModesTelegramAIBot.prototype);
  bot.config = {
    miniAppEnabled: true,
    maxInputChars: 12000,
    maxOutputChars: 3500,
    adminUserIds: new Set(),
    allowedUserIds: new Set(),
    blockedUserIds: new Set(),
    guardDefaultAction: 'queue',
    enableSecretaryAutoReply: true,
    botCollaborationCooldownMs: 5000,
    inlineQueryDebounceMs: 100,
    inlineQueryResponseTimeoutMs: 7000,
    inlineQuerySearchTimeoutMs: 3500,
    inlineQueryCacheTtlMs: 60000,
    enableToolCalls: true,
    enableWebSearch: true,
    ...overrides.config
  };
  bot.db = {
    findUser() { return undefined; },
    ...overrides.db
  };
  bot.logger = { info() {}, warn() {}, error() {} };
  bot.platformBotInfo = overrides.platformBotInfo || {};
  bot.businessConnections = new Map();
  bot.processedPlatformMessages = new Set();
  bot.botPairCooldowns = new Map();
  bot.terminalBotReplyIds = new Set();
  bot.inlineQueryStates = new Map();
  bot.inlineResultCache = new Map();
  bot.bot = overrides.bot || { telegram: { async callApi() {} } };
  bot.getLocale = (ctx, storedUser = undefined) => {
    const preferred = String(storedUser?.preferredLanguage || '').trim().toLowerCase();
    if (preferred && preferred !== 'auto') return preferred;
    const sender = ctx?.from || ctx?.update?.inline_query?.from || {};
    const code = String(sender.language_code || 'zh').toLowerCase();
    if (code.startsWith('zh-hant') || /^zh-(?:tw|hk|mo)/.test(code)) return 'zh-hant';
    if (code.startsWith('zh')) return 'zh';
    return code.split('-')[0] || 'en';
  };
  bot.isAllowed = () => true;
  bot.checkRateLimit = () => true;
  bot.formatLogError = (error) => ({ detail: String(error?.message || error) });
  bot.formatUserFacingError = () => '暂时无法处理。';
  return Object.assign(bot, overrides.methods || {});
}

test('/help owns the five Telegram platform mode buttons while /whoami stays clean', async () => {
  const bot = createBot();
  const replies = [];
  await bot.handleHelp({
    reply: async (text, extra) => replies.push({ text, extra })
  });

  assert.equal(replies.length, 1);
  const buttons = replies[0].extra.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map((button) => button.text), [
    'Inline Mode',
    'Guest Chat Mode',
    'Guard Mode',
    'Secretary Mode',
    'Bot-to-Bot Communication'
  ]);
  assert.equal(bot.createWhoamiKeyboard({}, 'zh'), undefined);
  assert.match(replies[0].text, /Telegram 扩展模式/);
  assert.match(replies[0].text, /把 @botusername 放在句末/);
  assert.match(replies[0].text, /\/ask@botusername/);
  assert.match(PlatformModesTelegramAIBot.prototype.constructor.toString(), /platform_mode:/);
  assert.doesNotMatch(PlatformModesTelegramAIBot.prototype.registerCommands.toString(), /platform_mode:/);
});

test('inline mode returns a personal AI article with short Telegram caching', async () => {
  const bot = createBot({
    methods: {
      async completePlatformRequest({ text }) {
        assert.equal(text, '解释人工智能');
        return '人工智能是一类让机器完成智能任务的技术。';
      }
    }
  });
  const answers = [];
  await bot.handleInlineQuery({
    update: {
      inline_query: {
         query: '解释人工智能',
        from: { id: 11, language_code: 'zh-CN' }
      }
    },
    answerInlineQuery: async (results, extra) => answers.push({ results, extra })
  });

  assert.equal(answers.length, 1);
  assert.equal(answers[0].results[0].type, 'article');
  assert.equal(answers[0].results[0].input_message_content.message_text, '人工智能是一类让机器完成智能任务的技术。');
  assert.deepEqual(answers[0].extra, { cache_time: 30, is_personal: true });
});

test('/ask is an unambiguous human group entry and preserves bot-to-bot behavior', async () => {
  const calls = [];
  const bot = createBot({
    methods: {
      async handleIncomingMessage(ctx, options) {
        calls.push({ text: ctx.message.text, options });
      }
    }
  });
  bot.botUsername = 'assistant_bot';
  const ctx = {
    payload: '请解释这个问题',
    from: { id: 11, is_bot: false },
    chat: { id: -100, type: 'group' },
    message: { text: '/ask@assistant_bot 请解释这个问题' },
    reply: async () => undefined
  };

  await bot.handleBotAskCommand(ctx);
  assert.deepEqual(calls, [{ text: '请解释这个问题', options: { forceRespond: true } }]);
  assert.equal(ctx.message.text, '/ask@assistant_bot 请解释这个问题');
});

test('group trigger filtering runs before natural actions and strips exact mentions', async () => {
  let routedText = '';
  let routedCalls = 0;
  const bot = createBot({
    config: { groupTriggerMode: 'smart', groupTriggerKeyword: 'ai' },
    db: {
      findUser() { return { id: '12' }; },
      findChat() { return { triggerMode: 'smart', keyword: 'ai' }; }
    },
    methods: {
      async handleBottomKeyboardAction(ctx) {
        routedCalls += 1;
        routedText = ctx.message.text;
        return true;
      }
    }
  });
  bot.botUserId = '500';
  bot.botUsername = 'assistant_bot';

  await bot.handleIncomingMessage({
    from: { id: 12 },
    chat: { id: -100, type: 'group' },
    message: { text: '今日新闻' }
  });
  assert.equal(routedCalls, 0, 'unaddressed group text must not reach search/translation/menu routing');

  const addressed = {
    from: { id: 12 },
    chat: { id: -100, type: 'group' },
    message: {
      text: '今日新闻 @assistant_bot',
      entities: [{ type: 'mention', offset: 5, length: 14 }]
    }
  };
  await bot.handleIncomingMessage(addressed);
  assert.equal(routedCalls, 1);
  assert.equal(routedText, '今日新闻');
});

test('explicit pending actions work in groups without requiring a second mention', async () => {
  let handledText = '';
  const bot = createBot({
    config: { groupTriggerMode: 'mention', groupTriggerKeyword: 'ai' },
    db: {
      findUser() { return { id: '12' }; },
      findChat() { return { triggerMode: 'mention', keyword: 'ai' }; }
    },
    methods: {
      async handleBottomKeyboardAction() { return false; },
      async handlePendingMenuAction(ctx) {
        handledText = ctx.message.text;
        return true;
      }
    }
  });
  bot.pendingMenuActions = new Map();
  bot.activeModes = new Map();
  const ctx = {
    from: { id: 12 },
    chat: { id: -100, type: 'group' },
    message: { text: '需要处理的下一条内容' }
  };
  bot.setPendingMenuAction(ctx, { type: 'web_prompt' });

  await bot.handleIncomingMessage(ctx);
  assert.equal(handledText, '需要处理的下一条内容');
});

test('mention-only pings respect access control and punctuation does not consume AI quota', async () => {
  const replies = [];
  let quotaCalls = 0;
  const bot = createBot({
    config: { groupTriggerMode: 'mention', groupTriggerKeyword: 'ai' },
    db: {
      findUser() { return { id: '12', isBlocked: true }; },
      findChat() { return { triggerMode: 'mention', keyword: 'ai' }; }
    },
    methods: {
      isAllowed() { return false; },
      async consumeQuotaForContext() { quotaCalls += 1; return true; }
    }
  });
  bot.botUsername = 'assistant_bot';
  bot.botUserId = '500';

  await bot.handleIncomingMessage({
    from: { id: 12 },
    chat: { id: -100, type: 'group' },
    message: {
      text: '@assistant_bot？',
      entities: [{ type: 'mention', offset: 0, length: 14 }]
    },
    reply: async (text) => replies.push(text)
  });

  assert.equal(quotaCalls, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /没有.*权限|permission/i);
});

test('explicit translation is routed before news and search shortcuts', async () => {
  let translated;
  const bot = createBot({
    db: {
      findUser() { return { id: '12' }; },
      findChat() { return {}; }
    },
    methods: {
      async handleBottomKeyboardAction() { return false; },
      async runTranslation(_ctx, text, targetLanguage) {
        translated = { text, targetLanguage };
      }
    }
  });

  await bot.handleIncomingMessage({
    from: { id: 12 },
    chat: { id: 12, type: 'private' },
    message: { text: '翻译 news' }
  });

  assert.deepEqual(translated, { text: 'news', targetLanguage: 'auto' });
});

test('messages sent via this bot inline are not processed again', async () => {
  let dbReads = 0;
  const bot = createBot({
    db: {
      findUser() { dbReads += 1; return undefined; },
      findChat() { dbReads += 1; return undefined; }
    }
  });
  bot.botUserId = '500';
  bot.botUsername = 'assistant_bot';

  await bot.handleIncomingMessage({
    from: { id: 12 },
    chat: { id: -100, type: 'group' },
    message: {
      text: 'Inline answer',
      via_bot: { id: 500, username: 'assistant_bot' }
    }
  });
  assert.equal(dbReads, 0);
});

test('inline translation takes priority over news search and sends only the translation', async () => {
  let aiRequest;
  let searchCalls = 0;
  let quotaCalls = 0;
  const answers = [];
  const bot = createBot({
    config: {
      translationProvider: 'gemini',
      translationModel: 'translation-model',
      defaultModel: 'chat-model'
    },
    db: {
      findUser() { return { id: '112', preferredLanguage: 'zh' }; },
      consumeDailyQuota() {
        quotaCalls += 1;
        return { allowed: true };
      },
      async write() {},
      async incrementStats() {}
    },
    methods: {
      async completeWithAiFallback(options) {
        aiRequest = options;
        return { result: { text: 'news\nTranslation: 新闻' } };
      }
    }
  });
  bot.toolRegistry = {
    async execute() {
      searchCalls += 1;
      throw new Error('translation must not invoke search');
    }
  };

  await bot.handleInlineQuery({
    update: { inline_query: { id: 'inline-translation', query: '翻译 news', from: { id: 112, language_code: 'zh-CN' } } },
    answerInlineQuery: async (results) => answers.push(results)
  });

  assert.equal(searchCalls, 0);
  assert.equal(quotaCalls, 1);
  assert.equal(aiRequest.scope, 'translation');
  assert.equal(aiRequest.capability, 'translation');
  assert.equal(aiRequest.preferredProvider, 'gemini');
  assert.equal(aiRequest.model, 'translation-model');
  assert.deepEqual(aiRequest.request.tools, []);
  assert.match(aiRequest.request.messages[1].content, /<source_text>\nnews\n<\/source_text>/);
  assert.doesNotMatch(aiRequest.request.messages[1].content, /翻译 news/);
  assert.equal(answers[0][0].title, '发送译文');
  assert.equal(answers[0][0].input_message_content.message_text, '新闻');
});

test('incomplete inline translation returns guidance without quota, search, or AI calls', async () => {
  let expensiveCalls = 0;
  const answers = [];
  const bot = createBot({
    db: {
      findUser() { return { id: '113' }; },
      consumeDailyQuota() {
        expensiveCalls += 1;
        return { allowed: true };
      }
    },
    methods: {
      async completeWithAiFallback() {
        expensiveCalls += 1;
        return { result: { text: 'must not run' } };
      },
      async getInlineSearchContext() {
        expensiveCalls += 1;
        return '';
      }
    }
  });

  const incompleteQueries = ['翻译：', '翻译成英文：', 'translate:', 'translate to English:', '中译英'];
  for (const [index, query] of incompleteQueries.entries()) {
    await bot.handleInlineQuery({
      update: { inline_query: { id: `inline-translation-incomplete-${index}`, query, from: { id: 113, language_code: 'zh-CN' } } },
      answerInlineQuery: async (results) => answers.push(results)
    });
  }

  assert.equal(expensiveCalls, 0);
  assert.equal(answers.length, incompleteQueries.length);
  for (const result of answers) assert.match(result[0].title, /继续输入翻译内容/);
});

test('translation parsing requires a real command boundary and keeps ambiguous source text intact', () => {
  const bot = createBot();

  assert.equal(bot.parseTranslationRequest('travel plans'), null);
  assert.equal(bot.parseTranslationRequest('trending news'), null);
  assert.equal(bot.parseTranslationRequest('trump news'), null);
  assert.equal(bot.parseTranslationRequest('翻译成英文：'), null);
  assert.deepEqual(bot.parseTranslationRequest('translate I want to go'), {
    targetLanguage: 'auto',
    text: 'I want to go'
  });
  assert.deepEqual(bot.parseTranslationRequest('translate hello to Chinese'), {
    targetLanguage: 'Simplified Chinese',
    text: 'hello'
  });
});

test('translation cleanup removes explicit echoes without deleting valid leading words', () => {
  assert.equal(platformModesInternals.cleanInlineTranslationOutput('I love you', 'I'), 'I love you');
  assert.equal(platformModesInternals.cleanInlineTranslationOutput('OpenAI builds AI', 'OpenAI'), 'OpenAI builds AI');
  assert.equal(platformModesInternals.cleanInlineTranslationOutput('hello\nTranslation: 你好', 'hello'), '你好');
});

test('source cleanup only removes a dedicated references heading', () => {
  const prose = '消息来源显示市场正在变化。\n第二段仍然必须保留。';
  assert.equal(naturalAgentInternals.stripGeneratedReferences(prose), prose);
  assert.equal(
    naturalAgentInternals.stripGeneratedReferences('正文保留\nSources:\n1. https://example.com'),
    '正文保留'
  );

  const context = JSON.stringify({
    results: Array.from({ length: 4 }, (_, index) => ({
      title: `新闻 ${index + 1}`,
      description: `摘要 ${index + 1}`,
      url: `https://example.com/${index + 1}`,
      publishedAt: '2026-07-16T01:00:00.000Z'
    }))
  });
  const digest = platformModesInternals.formatInlineNewsDigest(context, prose, 'zh', 'Asia/Shanghai');
  for (let index = 1; index <= 4; index += 1) assert.match(digest, new RegExp(`新闻 ${index}`));
});

test('inline cache preserves case-sensitive translation queries', async () => {
  let aiCalls = 0;
  const bot = createBot({
    config: { enableWebSearch: false },
    db: {
      findUser() { return { id: '114' }; },
      consumeDailyQuota() { return { allowed: true }; },
      async write() {}
    },
    methods: {
      async completeWithAiFallback() {
        aiCalls += 1;
        return { result: { text: `translation-${aiCalls}` } };
      }
    }
  });
  const ctx = (id, query) => ({
    update: { inline_query: { id, query, from: { id: 114, language_code: 'en' } } },
    answerInlineQuery: async () => undefined
  });

  await bot.handleInlineQuery(ctx('case-1', 'translate polish'));
  await bot.handleInlineQuery(ctx('case-2', 'translate Polish'));
  assert.equal(aiCalls, 2);
});

test('inline mode honors the saved account language instead of Telegram device language', async () => {
  let requestLocale = '';
  const bot = createBot({
    db: {
      findUser() {
        return { id: '111', preferredLanguage: 'km', persona: 'default' };
      }
    },
    methods: {
      async completePlatformRequest(options) {
        requestLocale = options.locale;
        return 'ចម្លើយ';
      }
    }
  });
  const answers = [];

  await bot.handleInlineQuery({
    update: { inline_query: { id: 'saved-locale', query: 'hello', from: { id: 111, language_code: 'en-US' } } },
    answerInlineQuery: async (results) => answers.push(results)
  });

  assert.equal(requestLocale, 'km');
  assert.equal(answers[0][0].input_message_content.message_text, 'ចម្លើយ');
});

test('inline mode coalesces rapid typing and only calls AI for the last query', async () => {
  let aiCalls = 0;
  const answers = [];
  const bot = createBot({
    methods: {
      async completePlatformRequest({ text }) {
        aiCalls += 1;
        return `answer:${text}`;
      }
    }
  });
  const makeContext = (id, query) => ({
    update: {
      inline_query: {
        id,
        query,
        from: { id: 77, language_code: 'zh-CN' }
      }
    },
    answerInlineQuery: async (results, extra) => answers.push({ id, results, extra })
  });

  const first = bot.handleInlineQuery(makeContext('q1', '解释'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = bot.handleInlineQuery(makeContext('q2', '解释人工智能'));
  await Promise.all([first, second]);

  assert.equal(aiCalls, 1);
  assert.equal(answers.find((item) => item.id === 'q1').results.length, 0);
  assert.equal(
    answers.find((item) => item.id === 'q2').results[0].input_message_content.message_text,
    'answer:解释人工智能'
  );
});

test('new inline input cancels an in-flight answer without waiting for it', async () => {
  const answers = [];
  const bot = createBot({
    config: { inlineQueryResponseTimeoutMs: 1000 },
    methods: {
      async completePlatformRequest({ text }) {
        if (text === 'first question') return new Promise(() => {});
        return `answer:${text}`;
      }
    }
  });
  const makeContext = (id, query) => ({
    update: { inline_query: { id, query, from: { id: 771, language_code: 'en' } } },
    answerInlineQuery: async (results, extra) => answers.push({ id, results, extra })
  });

  const first = bot.handleInlineQuery(makeContext('running-1', 'first question'));
  await new Promise((resolve) => setTimeout(resolve, 130));
  const startedAt = Date.now();
  const second = bot.handleInlineQuery(makeContext('running-2', 'second question'));
  await Promise.all([first, second]);

  assert.ok(Date.now() - startedAt < 600);
  assert.deepEqual(answers.find((item) => item.id === 'running-1').results, []);
  assert.equal(
    answers.find((item) => item.id === 'running-2').results[0].input_message_content.message_text,
    'answer:second question'
  );
});

test('inline mode returns a retry article before its hard response deadline', async () => {
  const answers = [];
  const bot = createBot({
    config: { inlineQueryResponseTimeoutMs: 250 },
    methods: {
      async completePlatformRequest() {
        return new Promise(() => {});
      }
    }
  });

  const startedAt = Date.now();
  await bot.handleInlineQuery({
    update: { inline_query: { id: 'deadline-1', query: 'slow question', from: { id: 772, language_code: 'en' } } },
    answerInlineQuery: async (results, extra) => answers.push({ results, extra })
  });

  assert.ok(Date.now() - startedAt < 700);
  assert.equal(answers.length, 1);
  assert.match(answers[0].results[0].input_message_content.message_text, /took too long/i);
  assert.deepEqual(answers[0].extra, { cache_time: 1, is_personal: true });
});

test('expired inline query errors are swallowed and never answered twice', async () => {
  let answerCalls = 0;
  const bot = createBot({
    methods: {
      async completePlatformRequest() {
        return 'ready';
      }
    }
  });
  const expired = new Error('400: Bad Request: query is too old and response timeout expired or query ID is invalid');
  expired.response = {
    error_code: 400,
    description: 'Bad Request: query is too old and response timeout expired or query ID is invalid'
  };

  await bot.handleInlineQuery({
    update: { inline_query: { id: 'expired-1', query: 'hello', from: { id: 773, language_code: 'en' } } },
    async answerInlineQuery() {
      answerCalls += 1;
      throw expired;
    }
  });

  assert.equal(answerCalls, 1);
});

test('a transient Telegram send failure retries the same answer once', async () => {
  const responses = [];
  let answerCalls = 0;
  const bot = createBot({
    methods: {
      async completePlatformRequest() {
        return 'ready';
      }
    }
  });

  await bot.handleInlineQuery({
    update: { inline_query: { id: 'transient-1', query: 'hello', from: { id: 774, language_code: 'en' } } },
    async answerInlineQuery(results, extra) {
      answerCalls += 1;
      if (answerCalls === 1) throw new Error('503: temporary Telegram transport failure');
      responses.push({ results, extra });
    }
  });

  assert.equal(answerCalls, 2);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].results[0].input_message_content.message_text, 'ready');
});

test('inline articles use the same plain-text cleanup as private chat', () => {
  const article = platformModesInternals.inlineArticle('***重点***\n***\n**正文**\n### 标题', '**查询**');
  assert.equal(article.input_message_content.message_text, '重点\n\n正文\n标题');
  assert.equal(article.title, '查询');
  assert.doesNotMatch(article.input_message_content.message_text, /[\*#]/);
});

test('inline source HTML stays bounded and complete even when a result URL is oversized', () => {
  const raw = JSON.stringify({
    results: [
      { title: 'Oversized source', url: `https://example.com/${'a'.repeat(5000)}` },
      { title: 'Verified source', url: 'https://example.org/verified' }
    ]
  });
  const formatted = naturalAgentInternals.appendClickableReferences('***摘要***', raw, 'zh', 3900);
  const article = platformModesInternals.inlineArticle(formatted, '新闻', { html: true });

  assert.ok(formatted.length <= 3900);
  assert.match(formatted, /https:\/\/example\.org\/verified/);
  assert.equal((formatted.match(/<a /g) || []).length, (formatted.match(/<\/a>/g) || []).length);
  assert.equal(article.input_message_content.parse_mode, 'HTML');
  assert.equal(article.input_message_content.message_text, formatted);
});

test('inline HTML escaping respects the output cap with and without sources', () => {
  const escapeHeavyBody = '<&'.repeat(3000);
  const withoutSources = naturalAgentInternals.appendClickableReferences(
    escapeHeavyBody,
    JSON.stringify({ results: [] }),
    'zh',
    3900
  );
  const withSources = naturalAgentInternals.appendClickableReferences(
    escapeHeavyBody,
    JSON.stringify({ results: [{ title: 'Source', url: 'https://example.com/source' }] }),
    'en',
    3900
  );

  assert.ok(withoutSources.length <= 3900);
  assert.ok(withSources.length <= 3900);
  assert.ok(withSources.length > 3500, 'escape-aware truncation should use the available body budget');
  assert.match(withSources, /Sources:\n1\. <a href="https:\/\/example\.com\/source">Source<\/a>/);
});

test('inline search payload compaction preserves valid JSON and source metadata', () => {
  const raw = JSON.stringify({
    results: Array.from({ length: 20 }, (_, index) => ({
      title: `Result ${index}`,
      snippet: 'x'.repeat(2000),
      url: `https://example.com/${index}`,
      sourceName: `Source ${index}`,
      publishedAt: '2026-07-16T03:00:00.000Z'
    }))
  });
  const compact = naturalAgentInternals.compactToolPayload(raw, 6000);
  const parsed = JSON.parse(compact);

  assert.ok(compact.length <= 6000);
  assert.ok(parsed.results.length > 0);
  assert.equal(parsed.results[0].sourceName, 'Source 0');
  assert.equal(parsed.results[0].publishedAt, '2026-07-16T03:00:00.000Z');
});

test('unsafe Google News redirect targets never become Telegram link protocols', () => {
  const raw = JSON.stringify({
    results: [{
      title: 'Untrusted redirect',
      url: 'https://news.google.com/?url=javascript%3Aalert%281%29'
    }]
  });
  const formatted = naturalAgentInternals.appendClickableReferences('摘要', raw, 'zh', 3900);
  assert.doesNotMatch(formatted, /href="javascript:/i);
  assert.match(formatted, /href="https:\/\/news\.google\.com\//i);
});

test('inline Telegram delivery is bounded and aborts a stuck API request', async () => {
  const bot = createBot({ config: { inlineQueryResponseTimeoutMs: 250 } });
  let calls = 0;
  let signalSeen = false;
  const startedAt = Date.now();

  const delivered = await bot.answerInlineQuerySafely({
    update: { inline_query: { id: 'stuck-delivery' } },
    telegram: {
      async callApi(_method, _payload, options) {
        calls += 1;
        signalSeen = Boolean(options?.signal);
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }
    }
  }, 'stuck-delivery', [], { cache_time: 1, is_personal: true });

  assert.equal(delivered, false);
  assert.equal(calls, 1);
  assert.equal(signalSeen, true);
  assert.ok(Date.now() - startedAt < 1000);
});

test('inline delivery does not retry non-transient Telegram errors', async () => {
  const bot = createBot();
  let calls = 0;
  const error = new Error('429: Too Many Requests');
  error.response = { error_code: 429, description: 'Too Many Requests' };

  await assert.rejects(() => bot.answerInlineQuerySafely({
    update: { inline_query: { id: 'rate-limited-delivery' } },
    async answerInlineQuery() {
      calls += 1;
      throw error;
    }
  }, 'rate-limited-delivery', [], { cache_time: 1, is_personal: true }), /429/);

  assert.equal(calls, 1);
});

test('inline delivery retries malformed Telegram HTML once as plain text', async () => {
  const bot = createBot();
  const payloads = [];
  const error = new Error("400: Bad Request: can't parse entities");
  error.response = { error_code: 400, description: "Bad Request: can't parse entities" };
  const article = platformModesInternals.inlineArticle(
    '摘要\n\n参考来源：\n1. <a href="https://example.com/news">Example</a>',
    '新闻',
    { html: true }
  );

  const delivered = await bot.answerInlineQuerySafely({
    update: { inline_query: { id: 'html-retry' } },
    async answerInlineQuery(results) {
      payloads.push(results);
      if (payloads.length === 1) throw error;
    }
  }, 'html-retry', [article], { cache_time: 1, is_personal: true });

  assert.equal(delivered, true);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0][0].input_message_content.parse_mode, 'HTML');
  assert.equal('parse_mode' in payloads[1][0].input_message_content, false);
  assert.match(payloads[1][0].input_message_content.message_text, /Example/);
});

test('inline news search uses dated RSS without starting undated web search', async () => {
  let toolTimeoutMs = 0;
  let newsTimeoutMs = 0;
  let toolStartedAt = 0;
  let newsStartedAt = 0;
  let toolAborted = false;
  let receivedOptions;
  const originalNewsFallback = naturalAgentInternals.fetchNewsFallback;
  const bot = createBot({ config: { inlineQuerySearchTimeoutMs: 120 } });
  bot.toolRegistry = {
    async execute(_toolCall, context) {
      toolTimeoutMs = context.requestTimeoutMs;
      toolStartedAt = Date.now();
      return new Promise((resolve) => {
        context.signal.addEventListener('abort', () => {
          toolAborted = true;
          resolve(JSON.stringify({ ok: false, error: 'TOOL_EXECUTION_FAILED' }));
        }, { once: true });
      });
    }
  };
  naturalAgentInternals.fetchNewsFallback = async (_query, options) => {
    receivedOptions = options;
    newsTimeoutMs = options.timeoutMs;
    newsStartedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 15));
    return JSON.stringify({
      results: [{ title: 'Fresh headline', url: 'https://example.com/news' }]
    });
  };

  let raw;
  try {
    raw = await bot.getInlineSearchContext({ userId: '775', query: 'latest AI news', timeoutMs: 120 });
  } finally {
    naturalAgentInternals.fetchNewsFallback = originalNewsFallback;
  }

  assert.equal(toolTimeoutMs, 0);
  assert.equal(newsTimeoutMs, 120);
  assert.equal(toolStartedAt, 0);
  assert.ok(newsStartedAt > 0);
  assert.equal(toolAborted, false);
  assert.equal(receivedOptions?.todayOnly, false);
  assert.match(raw, /Fresh headline/);
});

test('general news never starts an undated web search when dated RSS is available', async () => {
  const originalNewsFallback = naturalAgentInternals.fetchNewsFallback;
  const bot = createBot({ config: { inlineQuerySearchTimeoutMs: 500 } });
  let toolCalls = 0;
  bot.toolRegistry = {
    async execute() {
      toolCalls += 1;
      return JSON.stringify({ results: [{ title: 'Old undated result', url: 'https://old.example/news' }] });
    }
  };
  naturalAgentInternals.fetchNewsFallback = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return JSON.stringify({
      results: [{
        title: 'Fresh dated result',
        url: 'https://fresh.example/news',
        publishedAt: '2026-07-16T03:00:00.000Z'
      }]
    });
  };

  try {
    const raw = await bot.getInlineSearchContext({ userId: '775', query: 'latest AI news', timeoutMs: 500 });
    assert.match(raw, /Fresh dated result/);
    assert.doesNotMatch(raw, /Old undated result/);
    assert.equal(toolCalls, 0);
  } finally {
    naturalAgentInternals.fetchNewsFallback = originalNewsFallback;
  }
});

test('inline RSS fallback only runs for explicit news intent', async () => {
  let newsCalls = 0;
  const originalNewsFallback = naturalAgentInternals.fetchNewsFallback;
  const bot = createBot();
  bot.toolRegistry = {
    async execute() {
      return JSON.stringify({
        results: [{ title: 'Exchange rate', url: 'https://example.com/rates' }]
      });
    }
  };
  naturalAgentInternals.fetchNewsFallback = async () => {
    newsCalls += 1;
    return JSON.stringify({ results: [{ title: 'Unrelated news' }] });
  };

  try {
    const raw = await bot.getInlineSearchContext({ userId: '775', query: '最新汇率' });
    assert.match(raw, /Exchange rate/);
  } finally {
    naturalAgentInternals.fetchNewsFallback = originalNewsFallback;
  }

  assert.equal(newsCalls, 0);
  assert.equal(platformModesInternals.isInlineNewsQuery('今日新闻'), true);
  assert.equal(platformModesInternals.isInlineNewsQuery('latest news'), true);
  assert.notEqual(platformModesInternals.inlineSearchQuery('最近发生了什么'), '');
  assert.notEqual(platformModesInternals.inlineSearchQuery('今日头条'), '');
  assert.notEqual(platformModesInternals.inlineSearchQuery('热点时事资讯'), '');
  assert.equal(platformModesInternals.isInlineNewsQuery('最新汇率'), false);
  assert.equal(platformModesInternals.isInlineNewsQuery('今天新加坡天气'), false);
});

test('dated news RSS remains available when model tool calling is disabled', async () => {
  const originalNewsFallback = naturalAgentInternals.fetchNewsFallback;
  const bot = createBot({ config: { enableToolCalls: false, enableWebSearch: true } });
  bot.toolRegistry = undefined;
  let receivedOptions;
  naturalAgentInternals.fetchNewsFallback = async (_query, options) => {
    receivedOptions = options;
    return JSON.stringify({
      results: [{
        title: 'Verified dated news',
        url: 'https://example.com/dated',
        publishedAt: '2026-07-16T03:00:00.000Z'
      }]
    });
  };

  try {
    const raw = await bot.getInlineSearchContext({ userId: '775', query: 'today news', locale: 'km' });
    assert.match(raw, /Verified dated news/);
    assert.equal(receivedOptions.todayOnly, true);
    assert.equal(receivedOptions.language, 'km');
  } finally {
    naturalAgentInternals.fetchNewsFallback = originalNewsFallback;
  }
});

test('quota guard only charges one expensive action per Telegram update', async () => {
  let consumeCalls = 0;
  let accessChecks = 0;
  let rateChecks = 0;
  const bot = createBot({
    config: { dailyQuota: 5 },
    db: {
      consumeDailyQuota() {
        consumeCalls += 1;
        return { allowed: true, remaining: 4, quota: 5 };
      },
      async write() {}
    },
    methods: {
      isAllowed() {
        accessChecks += 1;
        return true;
      },
      checkRateLimit() {
        rateChecks += 1;
        return true;
      }
    }
  });
  const ctx = { from: { id: 776 }, state: {}, reply: async () => undefined };

  assert.equal(await bot.consumeQuotaForContext(ctx), true);
  assert.equal(await bot.consumeQuotaForContext(ctx), true);
  assert.equal(consumeCalls, 1);
  assert.equal(accessChecks, 1);
  assert.equal(rateChecks, 1);
  assert.equal(bot.formatDailyQuotaValue(0, 'zh'), '不限');
  assert.equal(bot.formatDailyQuotaValue(0, 'en'), 'unlimited');
});

test('shared costly-action guard rejects blocked users before quota or providers', async () => {
  let consumeCalls = 0;
  let providerCalls = 0;
  const replies = [];
  const bot = createBot({
    db: {
      consumeDailyQuota() {
        consumeCalls += 1;
        return { allowed: true };
      }
    },
    methods: {
      isAllowed() { return false; },
      t(_locale, key) { return key === 'noAccess' ? 'no access' : key; }
    }
  });
  const ctx = {
    from: { id: 778 },
    state: {},
    reply: async (message) => replies.push(message)
  };

  if (await bot.consumeQuotaForContext(ctx)) providerCalls += 1;

  assert.equal(providerCalls, 0);
  assert.equal(consumeCalls, 0);
  assert.deepEqual(replies, ['no access']);
});

test('exhausted inline quota stops before web search or AI', async () => {
  let searchCalls = 0;
  let aiCalls = 0;
  const answers = [];
  const bot = createBot({
    config: { dailyQuota: 1 },
    db: {
      findUser() { return { id: '779' }; },
      consumeDailyQuota() {
        return { allowed: false, remaining: 0, quota: 1 };
      },
      async write() {}
    },
    methods: {
      async completePlatformRequest() {
        aiCalls += 1;
        return 'must not run';
      }
    }
  });
  bot.toolRegistry = {
    async execute() {
      searchCalls += 1;
      return JSON.stringify({ results: [{ title: 'must not run' }] });
    }
  };

  await bot.handleInlineQuery({
    update: {
      inline_query: {
        id: 'quota-empty',
        query: '今日新闻',
        from: { id: 779, language_code: 'zh-CN' }
      }
    },
    answerInlineQuery: async (results) => answers.push(results)
  });

  assert.equal(searchCalls, 0);
  assert.equal(aiCalls, 0);
  assert.match(answers[0][0].input_message_content.message_text, /额度/);
});

test('superseded inline work refunds immediately even when provider ignores abort', async () => {
  let usage = 0;
  const answers = [];
  const bot = createBot({
    config: { dailyQuota: 1, enableWebSearch: false },
    db: {
      findUser() { return { id: '780' }; },
      consumeDailyQuota() {
        if (usage >= 1) return { allowed: false, remaining: 0, quota: 1 };
        usage += 1;
        return { allowed: true, remaining: 0, quota: 1 };
      },
      refundDailyQuota() { usage = Math.max(0, usage - 1); },
      async write() {}
    },
    methods: {
      async completePlatformRequest({ text }) {
        if (text === 'first question') {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return `answer:${text}`;
      }
    }
  });
  const context = (id, query) => ({
    update: { inline_query: { id, query, from: { id: 780, language_code: 'zh-CN' } } },
    answerInlineQuery: async (results) => answers.push({ id, results })
  });

  const first = bot.handleInlineQuery(context('quota-first', 'first question'));
  await new Promise((resolve) => setTimeout(resolve, 130));
  const second = bot.handleInlineQuery(context('quota-second', 'second question'));
  await Promise.all([first, second]);

  assert.equal(usage, 1);
  assert.equal(answers.find((item) => item.id === 'quota-first').results.length, 0);
  assert.match(
    answers.find((item) => item.id === 'quota-second').results[0].input_message_content.message_text,
    /answer:second question/
  );
});

test('failed platform AI work refunds its reserved quota', async () => {
  let usage = 0;
  let refunds = 0;
  const bot = createBot({
    config: { dailyQuota: 1 },
    db: {
      findUser() { return { id: '777' }; },
      consumeDailyQuota() {
        usage += 1;
        return { allowed: true, remaining: 0, quota: 1 };
      },
      refundDailyQuota() {
        refunds += 1;
        usage = Math.max(0, usage - 1);
      },
      async write() {},
      async incrementStats() {}
    },
    methods: {
      getEffectiveAISettings() {
        return { providerId: 'gemini', modelId: 'test-model', fallbackEnabled: true };
      },
      async completeWithAiFallback() {
        throw Object.assign(new Error('superseded'), { code: 'INLINE_QUERY_SUPERSEDED' });
      }
    }
  });

  await assert.rejects(
    bot.completePlatformRequest({ userId: '777', text: 'question' }),
    (error) => error?.code === 'INLINE_QUERY_SUPERSEDED'
  );
  assert.equal(refunds, 1);
  assert.equal(usage, 0);
});

test('a quota-refund persistence error never suppresses the prepared inline reply', async () => {
  let usage = 0;
  let writes = 0;
  const warnings = [];
  const answers = [];
  const bot = createBot({
    db: {
      findUser() { return { id: '778' }; },
      consumeDailyQuota() {
        usage += 1;
        return { allowed: true };
      },
      refundDailyQuota() {
        usage = Math.max(0, usage - 1);
      },
      async write() {
        writes += 1;
        if (writes > 1) throw new Error('injected refund persistence failure');
      }
    },
    methods: {
      async completePlatformRequest() {
        throw new Error('provider unavailable');
      }
    }
  });
  bot.logger.warn = (message) => warnings.push(message);

  await bot.handleInlineQuery({
    update: { inline_query: { id: 'refund-write-fail', query: 'hello', from: { id: 778, language_code: 'en' } } },
    answerInlineQuery: async (results) => answers.push(results)
  });

  assert.equal(usage, 0);
  assert.equal(answers.length, 1);
  assert.match(answers[0][0].input_message_content.message_text, /暂时无法处理/);
  assert.ok(warnings.includes('Failed to persist inline quota refund'));
});

test('empty inline query cancels pending work and never invokes AI or search', async () => {
  let aiCalls = 0;
  let searchCalls = 0;
  const answers = [];
  const bot = createBot({
    methods: {
      async completePlatformRequest() {
        aiCalls += 1;
        return 'must not run';
      }
    }
  });
  bot.toolRegistry = {
    async execute() {
      searchCalls += 1;
      return '{}';
    }
  };
  const makeContext = (id, query) => ({
    update: { inline_query: { id, query, from: { id: 79, language_code: 'zh-CN' } } },
    answerInlineQuery: async (results, extra) => answers.push({ id, results, extra })
  });

  const pending = bot.handleInlineQuery(makeContext('pending', '今日新闻'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const empty = bot.handleInlineQuery(makeContext('empty', ''));
  await Promise.all([pending, empty]);

  assert.equal(aiCalls, 0);
  assert.equal(searchCalls, 0);
  assert.deepEqual(answers.find((item) => item.id === 'empty').results, []);
  assert.deepEqual(answers.find((item) => item.id === 'empty').extra, { cache_time: 30, is_personal: true });
});

test('inline current-information query prefetches web results and forces provider fallback', async () => {
  const calls = [];
  const originalNewsFallback = naturalAgentInternals.fetchNewsFallback;
  const bot = createBot({
    methods: {
      async completePlatformRequest(options) {
        calls.push({ type: 'ai', options });
        return '***这是联网后的新闻摘要。***\n来源：https://fake.example/news';
      }
    }
  });
  bot.toolRegistry = {
    async execute() {
      throw new Error('strict today news must not use undated web results');
    }
  };
  naturalAgentInternals.fetchNewsFallback = async (query, options) => {
    calls.push({ type: 'rss', query, options });
    return JSON.stringify({
      provider: 'google-news-rss',
      results: Array.from({ length: 4 }, (_, index) => ({
        title: `今日新闻 ${index + 1}`,
        sourceName: `Example News ${index + 1}`,
        publishedAt: `2026-07-16T0${index + 1}:00:00.000Z`,
        url: `https://example.com/news-${index + 1}`,
        description: `Example News ${index + 1} · 2026/07/16 ${9 + index}:00`
      }))
    });
  };
  const answers = [];

  try {
    await bot.handleInlineQuery({
      update: { inline_query: { id: 'live-1', query: '今日新闻', from: { id: 80, language_code: 'zh-CN' } } },
      answerInlineQuery: async (results) => answers.push(results)
    });
  } finally {
    naturalAgentInternals.fetchNewsFallback = originalNewsFallback;
  }

  assert.equal(calls[0].type, 'rss');
  assert.equal(calls[0].query, '今日新闻');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.timeoutMs, 3500);
  assert.equal(calls[1].type, 'ai');
  assert.equal(calls[1].options.fallbackEnabled, true);
  assert.ok(calls[1].options.signal instanceof AbortSignal);
  assert.ok(calls[1].options.requestTimeoutMs > 0);
  assert.ok(calls[1].options.requestTimeoutMs <= 7000);
  assert.match(calls[1].options.retrievedContext, /example\.com\/news/);
  assert.match(calls[1].options.role, /live-search/);
  assert.equal(answers[0].length, 5, 'digest plus four individual news results should be returned');
  assert.match(answers[0][0].title, /新闻摘要.*4 条/);
  assert.equal(answers[0][1].title, '今日新闻 1');
  assert.equal(answers[0][4].title, '今日新闻 4');
  const message = answers[0][0].input_message_content;
  assert.match(message.message_text, /这是联网后的新闻摘要/);
  assert.match(message.message_text, /参考来源/);
  assert.match(message.message_text, /今日新闻 1/);
  assert.match(message.message_text, /今日新闻 4/);
  assert.match(message.message_text, /Example News/);
  assert.match(message.message_text, /2026.*07.*16/);
  assert.match(message.message_text, /https:\/\/example\.com\/news-1/);
  assert.doesNotMatch(message.message_text, /fake\.example|\*\*\*/);
  assert.equal(message.parse_mode, 'HTML');
});

test('strict today news never falls back to an old undated web result', async () => {
  const originalNewsFallback = naturalAgentInternals.fetchNewsFallback;
  let toolCalls = 0;
  let aiCalls = 0;
  const bot = createBot({
    methods: {
      async completePlatformRequest() {
        aiCalls += 1;
        return 'must not run';
      }
    }
  });
  bot.toolRegistry = {
    async execute(toolCall, context) {
      void toolCall;
      void context;
      toolCalls += 1;
      return JSON.stringify({
        results: [{ title: 'Old story', url: 'https://old.example/story' }]
      });
    }
  };
  naturalAgentInternals.fetchNewsFallback = async () => '';
  const answers = [];

  try {
    await bot.handleInlineQuery({
      update: { inline_query: { id: 'today-empty', query: '今日新闻', from: { id: 80, language_code: 'zh-CN' } } },
      answerInlineQuery: async (results) => answers.push(results)
    });
  } finally {
    naturalAgentInternals.fetchNewsFallback = originalNewsFallback;
  }

  const text = answers[0][0].input_message_content.message_text;
  assert.equal(toolCalls, 0);
  assert.equal(aiCalls, 0);
  assert.match(text, /不会用旧闻冒充今日结果/);
  assert.doesNotMatch(text, /Old story/);
});

test('inline search formats retrieved results when AI generation fails', async () => {
  const bot = createBot({
    methods: {
      async completePlatformRequest() {
        throw new Error('AI request failed (429): quota');
      }
    }
  });
  bot.toolRegistry = {
    async execute() {
      return JSON.stringify({
        results: [{
          title: 'OpenAI update',
          snippet: 'A fresh search summary.',
          url: 'https://example.com/openai'
        }]
      });
    }
  };
  const answers = [];

  await bot.handleInlineQuery({
    update: { inline_query: { id: 'search-ai-fail', query: '请搜索 OpenAI', from: { id: 801, language_code: 'en' } } },
    answerInlineQuery: async (results, extra) => answers.push({ results, extra })
  });

  const text = answers[0].results[0].input_message_content.message_text;
  assert.match(text, /Live search results/);
  assert.match(text, /OpenAI update/);
  assert.match(text, /A fresh search summary/);
  assert.match(text, /https:\/\/example\.com\/openai/);
  assert.deepEqual(answers[0].extra, { cache_time: 10, is_personal: true });
});

test('inline explicit search failure is reported without asking a model to invent an answer', async () => {
  let aiCalls = 0;
  const bot = createBot({
    methods: {
      async completePlatformRequest() {
        aiCalls += 1;
        return 'invented answer';
      }
    }
  });
  bot.toolRegistry = {
    async execute() {
      return JSON.stringify({ ok: false, error: 'TOOL_EXECUTION_FAILED' });
    }
  };
  const answers = [];

  await bot.handleInlineQuery({
    update: { inline_query: { id: 'search-fail', query: '请搜索 OpenAI', from: { id: 82, language_code: 'zh-CN' } } },
    answerInlineQuery: async (results) => answers.push(results)
  });

  assert.equal(aiCalls, 0);
  assert.match(answers[0][0].input_message_content.message_text, /实时搜索暂时没有返回有效结果/);
  assert.equal(platformModesInternals.inlineSearchQuery('帮我搜索 OpenAI'), 'OpenAI');
});

test('retrieved inline search context works with models that do not support tool calling', async () => {
  let request;
  const bot = createBot({
    config: { defaultModel: 'free-model' },
    db: {
      findUser() {
        return {
          id: '81',
          preferredLanguage: 'km',
          customSystemPrompt: 'CUSTOM INLINE PERSONA'
        };
      },
      consumeDailyQuota() {
        return { allowed: true };
      },
      async incrementStats() {}
    },
    methods: {
      getEffectiveAISettings() {
        return { providerId: 'free-provider', modelId: 'free-model', fallbackEnabled: false };
      },
      checkRateLimit() {
        return true;
      },
      async completeWithAiFallback(options) {
        request = options;
        return { result: { text: 'grounded answer' }, providerId: 'fallback-provider', model: 'fallback-model' };
      },
      normalizeAiResult(result) {
        return result;
      }
    }
  });
  bot.toolRegistry = {
    getDefinitions() {
      throw new Error('prefetched search must not require model tool calling');
    }
  };

  const controller = new AbortController();
  const answer = await bot.completePlatformRequest({
    userId: '81',
    text: '最新消息',
    scope: 'telegram_inline',
    fallbackEnabled: true,
    retrievedContext: '{"results":[{"title":"fresh"}]}',
    requestTimeoutMs: 500,
    signal: controller.signal
  });

  assert.equal(answer, 'grounded answer');
  assert.equal(request.fallbackEnabled, true);
  assert.equal(request.preferredProvider, 'free-provider');
  assert.equal(request.model, 'free-model');
  assert.equal(request.request.suppressTimeoutCooldown, true);
  assert.deepEqual(request.request.tools, []);
  assert.match(request.request.messages[1].content, /fresh web search data/i);
  assert.match(request.request.messages[0].content, /CUSTOM INLINE PERSONA/);
  assert.match(request.request.messages[0].content, /Do not use Markdown headings/);
  assert.match(request.request.messages[0].content, /never invent a source/);
  assert.doesNotMatch(request.request.messages[0].content, /Use only its dated facts/);
});

test('inline mode reuses a personal short-term cache for identical queries', async () => {
  let aiCalls = 0;
  let quotaCalls = 0;
  let rateChecks = 0;
  const bot = createBot({
    db: {
      findUser() { return { id: '78', persona: 'default' }; },
      consumeDailyQuota() {
        quotaCalls += 1;
        return { allowed: true };
      },
      async write() {}
    },
    methods: {
      checkRateLimit() {
        rateChecks += 1;
        return true;
      },
      async completePlatformRequest() {
        aiCalls += 1;
        return 'cached answer';
      }
    }
  });
  bot.rateLimits = new Map();
  const makeContext = (id) => ({
    update: { inline_query: { id, query: 'same question', from: { id: 78, language_code: 'en' } } },
    answerInlineQuery: async () => undefined
  });

  await bot.handleInlineQuery(makeContext('same-1'));
  await bot.handleInlineQuery(makeContext('same-2'));
  assert.equal(aiCalls, 1);
  assert.equal(quotaCalls, 1);
  assert.equal(rateChecks, 1);
});

test('inline cache preserves source HTML and invalidates when persona settings change', async () => {
  let aiCalls = 0;
  let searchCalls = 0;
  const user = { id: '781', persona: 'default', preferredLanguage: 'en' };
  const answers = [];
  const bot = createBot({
    db: {
      findUser() { return user; },
      consumeDailyQuota() { return { allowed: true }; },
      async write() {}
    },
    methods: {
      async getInlineSearchContext() {
        searchCalls += 1;
        return JSON.stringify({
          results: [{ title: 'Fresh source', url: 'https://example.com/fresh' }]
        });
      },
      async completePlatformRequest() {
        aiCalls += 1;
        return `***answer:${user.persona}***`;
      }
    }
  });
  const makeContext = (id) => ({
    update: { inline_query: { id, query: 'search latest update', from: { id: 781, language_code: 'zh-CN' } } },
    answerInlineQuery: async (results) => answers.push(results[0])
  });

  await bot.handleInlineQuery(makeContext('html-cache-1'));
  await bot.handleInlineQuery(makeContext('html-cache-2'));
  assert.equal(aiCalls, 1);
  assert.equal(searchCalls, 1);
  assert.equal(answers[0].input_message_content.parse_mode, 'HTML');
  assert.equal(answers[1].input_message_content.parse_mode, 'HTML');
  assert.match(answers[1].input_message_content.message_text, /<a href="https:\/\/example\.com\/fresh">/);
  assert.doesNotMatch(answers[1].input_message_content.message_text, /\*\*\*/);

  user.persona = 'teacher';
  await bot.handleInlineQuery(makeContext('html-cache-3'));
  assert.equal(aiCalls, 2);
  assert.equal(searchCalls, 2);
  assert.match(answers[2].input_message_content.message_text, /answer:teacher/);
});

test('guest mode answers once through answerGuestQuery without saving a conversation', async () => {
  const calls = [];
  const bot = createBot({
    bot: {
      telegram: {
        async callApi(method, payload) {
          calls.push({ method, payload });
        }
      }
    },
    db: {
      setConversation() {
        throw new Error('guest content must not be persisted');
      }
    },
    methods: {
      async completePlatformRequest({ text }) {
        assert.equal(text, '请解释这段内容');
        return '这是一次访客回答。';
      }
    }
  });

  await bot.handleGuestMessage({
    update: {
      guest_message: {
        guest_query_id: 'guest-1',
        text: '请解释这段内容',
        chat: { id: -1001 },
        guest_bot_caller_user: { id: 12, language_code: 'zh-CN' }
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'answerGuestQuery');
  assert.equal(calls[0].payload.guest_query_id, 'guest-1');
  assert.equal(calls[0].payload.result.input_message_content.message_text, '这是一次访客回答。');
});

test('platform modes refund reserved quota when Telegram delivery fails', async (t) => {
  await t.test('guest', async () => {
    let refunds = 0;
    const bot = createBot({
      bot: { telegram: { async callApi() { throw new Error('delivery failed'); } } },
      db: {
        refundDailyQuota() { refunds += 1; },
        async write() {}
      },
      methods: {
        async ensurePlatformUser() {},
        async completePlatformRequest({ quotaReservation }) {
          Object.assign(quotaReservation, { userId: '12', reserved: true });
          return 'answer';
        }
      }
    });

    await assert.rejects(() => bot.handleGuestMessage({
      update: {
        guest_message: {
          guest_query_id: 'guest-fail',
          text: 'question',
          chat: { id: -1001 },
          guest_bot_caller_user: { id: 12, language_code: 'en' }
        }
      }
    }), /delivery failed/);
    assert.equal(refunds, 1);
  });

  await t.test('secretary', async () => {
    let refunds = 0;
    const bot = createBot({
      bot: {
        telegram: {
          async callApi(method) {
            if (method === 'sendMessage') throw new Error('delivery failed');
          }
        }
      },
      db: {
        refundDailyQuota() { refunds += 1; },
        async write() {}
      },
      methods: {
        async ensurePlatformUser() {},
        async completePlatformRequest({ quotaReservation }) {
          Object.assign(quotaReservation, { userId: '42', reserved: true });
          return 'answer';
        }
      }
    });
    bot.businessConnections.set('biz-fail', {
      id: 'biz-fail',
      is_enabled: true,
      rights: { can_reply: true },
      user: { id: 42, language_code: 'en' }
    });

    await bot.handleBusinessMessage({
      update: {
        business_message: {
          business_connection_id: 'biz-fail',
          message_id: 8,
          text: 'question',
          from: { id: 88 },
          chat: { id: 88 }
        }
      }
    });
    assert.equal(refunds, 1);
  });

  await t.test('bot-to-bot', async () => {
    let upserts = 0;
    let refunds = 0;
    const bot = createBot({
      db: {
        async upsertUser() { upserts += 1; },
        refundDailyQuota() { refunds += 1; },
        async write() {}
      },
      methods: {
        async completePlatformRequest({ quotaReservation }) {
          Object.assign(quotaReservation, { userId: '600', reserved: true });
          return 'answer';
        }
      }
    });

    await assert.rejects(() => bot.answerBotMessage({
      from: { id: 600, is_bot: true },
      chat: { id: -1003 },
      message: { message_id: 12 },
      reply: async () => { throw new Error('delivery failed'); }
    }, 'question'), /delivery failed/);
    assert.equal(upserts, 1);
    assert.equal(refunds, 1);
  });
});

test('guard mode declines blocked users, approves allowlisted users, and queues unknown users', () => {
  const bot = createBot({
    config: {
      blockedUserIds: new Set(['1']),
      allowedUserIds: new Set(['2'])
    }
  });

  assert.equal(bot.guardDecision({ from: { id: 1 } }), 'decline');
  assert.equal(bot.guardDecision({ from: { id: 2 } }), 'approve');
  assert.equal(bot.guardDecision({ from: { id: 3 } }), 'queue');
});

test('Guard mode can be switched by an administrator and persists in database metadata', async () => {
  let savedMode = '';
  const bot = createBot({
    config: { adminUserIds: new Set(['42']) },
    db: {
      getMeta(key) {
        return key === 'guardDefaultAction' ? savedMode : '';
      },
      setMeta(key, value) {
        assert.equal(key, 'guardDefaultAction');
        savedMode = value;
      }
    }
  });
  const replies = [];
  await bot.handleGuardModeCallback({
    from: { id: 42 },
    match: ['', 'approve'],
    answerCbQuery: async () => undefined,
    reply: async (text, extra) => replies.push({ text, extra })
  });

  assert.equal(savedMode, 'approve');
  assert.equal(bot.guardDecision({ from: { id: 9002 } }), 'approve');
  assert.match(replies[0].text, /开放模式/);
  const modeButtons = replies[0].extra.reply_markup.inline_keyboard[0];
  assert.match(modeButtons[1].text, /✅/);
});

test('guard mode resolves a Telegram join request query', async () => {
  const calls = [];
  const bot = createBot({
    bot: {
      telegram: {
        async callApi(method, payload) {
          calls.push({ method, payload });
        }
      }
    }
  });

  await bot.handleGuardJoinRequest({
    update: {
      chat_join_request: {
        query_id: 'join-1',
        chat: { id: -1002 },
        from: { id: 99 }
      }
    }
  }, () => {
    throw new Error('handled guard queries must not fall through');
  });

  assert.deepEqual(calls, [{
    method: 'answerChatJoinRequestQuery',
    payload: { chat_join_request_query_id: 'join-1', result: 'queue' }
  }]);
});

test('Guard detail gives admins persistent allowlist and blocklist controls', async () => {
  const updated = [];
  let existingUser;
  const bot = createBot({
    config: { adminUserIds: new Set(['42']) },
    db: {
      findUser(id) {
        return String(id) === '9001' ? existingUser : undefined;
      },
      async upsertUser(user) {
        existingUser = { id: String(user.id), isAllowed: false, isBlocked: false };
        return existingUser;
      },
      async setUserSettings(id, patch) {
        existingUser = { ...existingUser, ...patch };
        updated.push({ id: String(id), patch });
        return existingUser;
      }
    }
  });
  bot.activeModes = new Map();
  bot.getPendingMenuKey = () => 'guard-admin';

  const keyboard = bot.createPlatformModeDetailKeyboard('zh', 'guard', { from: { id: 42 } });
  assert.deepEqual(
    keyboard.reply_markup.inline_keyboard.flat().map((button) => button.callback_data).filter(Boolean),
    [
      'guard_mode:queue', 'guard_mode:approve', 'guard_mode:decline',
      'guard_manage:allow', 'guard_manage:block', 'guard_manage:disallow',
      'guard_manage:unblock', 'guard_manage:list', 'platform_mode:back'
    ]
  );

  bot.setActiveMode({ from: { id: 42 } }, { type: 'guard_manage', action: 'allow' });
  const replies = [];
  const ctx = {
    from: { id: 42 },
    message: { text: '9001' },
    reply: async (text) => replies.push(text)
  };
  await bot.handleActiveMode(ctx, bot.getActiveMode(ctx));
  assert.deepEqual(updated, [{ id: '9001', patch: { isAllowed: true, isBlocked: false } }]);
  assert.match(replies[0], /9001/);
});

test('Guard synchronizes Telegram bans and unbans without blocking ordinary leaves', async () => {
  const users = new Map();
  const changes = [];
  const bot = createBot({
    db: {
      findUser(id) {
        return users.get(String(id));
      },
      async upsertUser(user) {
        const saved = { id: String(user.id), isAllowed: false, isBlocked: false };
        users.set(saved.id, saved);
        return saved;
      },
      async setUserSettings(id, patch) {
        const key = String(id);
        users.set(key, { ...users.get(key), ...patch });
        changes.push({ id: key, patch });
      }
    }
  });
  const context = (oldStatus, newStatus) => ({
    update: {
      chat_member: {
        chat: { id: -1002 },
        from: { id: 42 },
        old_chat_member: { status: oldStatus, user: { id: 9003, first_name: 'User' } },
        new_chat_member: { status: newStatus, user: { id: 9003, first_name: 'User' } }
      }
    }
  });

  await bot.handleGuardMemberUpdate(context('member', 'left'));
  assert.deepEqual(changes, []);

  await bot.handleGuardMemberUpdate(context('member', 'kicked'));
  assert.deepEqual(changes[0], { id: '9003', patch: { isBlocked: true, isAllowed: false } });

  await bot.handleGuardMemberUpdate(context('kicked', 'left'));
  assert.deepEqual(changes[1], { id: '9003', patch: { isBlocked: false } });
});

test('bot launch explicitly subscribes to chat member updates without dropping platform updates', async () => {
  let launchOptions;
  const bot = createBot({
    bot: {
      async launch(options) {
        launchOptions = options;
      },
      telegram: { async callApi() {} }
    }
  });

  await bot.launch();
  assert.equal(launchOptions.allowedUpdates.includes('chat_member'), true);
  assert.equal(launchOptions.allowedUpdates.includes('message'), true);
  assert.equal(launchOptions.allowedUpdates.includes('guest_message'), true);
  assert.deepEqual(launchOptions.allowedUpdates, [...platformModesInternals.TELEGRAM_ALLOWED_UPDATES]);
});

test('secretary mode replies through the business connection without writing customer text to chat history', async () => {
  const calls = [];
  const bot = createBot({
    bot: {
      telegram: {
        async callApi(method, payload) {
          calls.push({ method, payload });
        }
      }
    },
    db: {
      setConversation() {
        throw new Error('customer content must not be persisted');
      }
    },
    methods: {
      async completePlatformRequest({ text, role }) {
        assert.equal(text, '请问今天营业吗？');
        assert.match(role, /business secretary/);
        return '您好，今天正常营业。';
      }
    }
  });
  bot.businessConnections.set('biz-1', {
    id: 'biz-1',
    is_enabled: true,
    rights: { can_reply: true },
    user: { id: 42, language_code: 'zh-CN' }
  });

  await bot.handleBusinessMessage({
    update: {
      business_message: {
        business_connection_id: 'biz-1',
        message_id: 7,
        text: '请问今天营业吗？',
        from: { id: 88 },
        chat: { id: 88 }
      }
    }
  });

  assert.equal(calls[0].method, 'sendChatAction');
  assert.equal(calls[1].method, 'sendMessage');
  assert.equal(calls[1].payload.business_connection_id, 'biz-1');
  assert.equal(calls[1].payload.text, '您好，今天正常营业。');
});

test('bot-to-bot messages require an explicit reply and terminal replies stop the loop', async () => {
  const prompts = [];
  const bot = createBot({
    methods: {
      async answerBotMessage(_ctx, prompt) {
        prompts.push(prompt);
      }
    }
  });
  bot.botUserId = '500';
  bot.botUsername = 'assistant_bot';

  await bot.handlePossibleBotMessage({
    from: { id: 600, is_bot: true },
    chat: { id: -1003 },
    message: { message_id: 10, text: 'unaddressed' }
  }, async () => {});
  assert.deepEqual(prompts, []);

  const addressed = {
    from: { id: 600, is_bot: true },
    chat: { id: -1003 },
    message: {
      message_id: 11,
      text: 'review this',
      reply_to_message: { message_id: 5, from: { id: 500, username: 'assistant_bot' } }
    }
  };
  await bot.handlePossibleBotMessage(addressed, async () => {});
  assert.deepEqual(prompts, ['review this']);

  bot.terminalBotReplyIds.add('-1003:5');
  prompts.length = 0;
  await bot.handlePossibleBotMessage(addressed, async () => {});
  assert.deepEqual(prompts, []);
});
