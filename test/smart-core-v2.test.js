import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import {
  MemoryManager,
  isSafeLongTermMemory,
  rankMemoryItems
} from '../src/services/memory-manager.js';
import { ToolRegistry } from '../src/services/tool-registry.js';
import { TelegramAIBot } from '../src/services/telegram-bot.js';
import { PrivacyTelegramAIBot } from '../src/services/privacy-telegram-bot.js';
import { tryHandleNaturalAgent } from '../src/services/natural-agent.js';
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
    message: { message_id: 10, text: 'today news' },
    async sendChatAction() {},
    async reply(message, extra) {
      replies.push({ message, extra });
    }
  }, 'today news');

  assert.equal(replies.length, 1);
  assert.equal(replies[0].extra.parse_mode, 'HTML');
  assert.match(replies[0].message, /<a href="https:\/\/example\.com\/current-news">Example News<\/a>/);
  assert.doesNotMatch(replies[0].message.replace(/href="[^"]+"/g, ''), /https:\/\//);
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
