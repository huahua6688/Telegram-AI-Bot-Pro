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
