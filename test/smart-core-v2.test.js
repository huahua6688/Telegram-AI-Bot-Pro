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

test('empty AI results normalize instead of crashing text/message consumers', () => {
  const bot = Object.create(TelegramAIBot.prototype);
  const fallbackMessages = [{ role: 'user', content: 'hello' }];
  const result = bot.normalizeAiResult(undefined, fallbackMessages);

  assert.equal(result.text, '');
  assert.equal(result.messages, fallbackMessages);
});

test('toolbox exposes real feature callbacks and unknown buttons get a visible fallback', async () => {
  const bot = Object.create(TelegramAIBot.prototype);
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
