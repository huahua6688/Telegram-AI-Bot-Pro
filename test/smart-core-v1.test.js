import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { GeminiClient } from '../src/services/gemini-client.js';
import { ToolRegistry } from '../src/services/tool-registry.js';

const naturalAgentSource = fs.readFileSync('src/services/natural-agent.js', 'utf8');
const telegramBotSource = fs.readFileSync('src/services/telegram-bot.js', 'utf8');
const memorySource = fs.readFileSync('src/services/memory-manager.js', 'utf8');

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function logger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {}
  };
}

function webSearchDefinition() {
  return {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
      }
    }
  };
}

test('ordinary messages use one model loop without hidden intent classification', () => {
  const naturalHandler = extractBetween(
    naturalAgentSource,
    'export async function tryHandleNaturalAgent',
    '\nexport const naturalAgentInternals'
  );
  const incomingHandler = extractBetween(
    telegramBotSource,
    '  async handleIncomingMessage(ctx) {',
    '\n  async prepareUserMessage'
  );

  assert.doesNotMatch(naturalHandler, /await classifyNaturally/);
  assert.doesNotMatch(incomingHandler, /await this\.classifyUserIntent/);
  assert.match(incomingHandler, /const routedIntent = null/);
});

test('memory no longer seeds repository-specific facts into every user', () => {
  assert.doesNotMatch(memorySource, /huahua6688\/Telegram-AI-Bot-Pro/);
  assert.doesNotMatch(memorySource, /TOPIC_RULES/);
  assert.match(memorySource, /item\.source !== 'system_seed'/);

  const compatibilityMethod = extractBetween(
    memorySource,
    '  rememberProjectDefaults() {',
    '\n  extractJsonObject'
  );
  assert.doesNotMatch(compatibilityMethod, /upsertMemoryItem/);
});

test('Gemini search-capable models use native Google Search safely', () => {
  const client = new GeminiClient(
    {
      temperature: 0.4,
      enableWebSearch: true,
      enableGeminiGoogleSearch: true,
      aiMaxToolSteps: 3
    },
    logger()
  );
  const messages = [{ role: 'user', content: 'What happened today?' }];

  const currentPayload = client.toGeminiPayload(
    messages,
    [webSearchDefinition()],
    0.2,
    'gemini-3.5-flash'
  );
  assert.deepEqual(currentPayload.tools, [{ google_search: {} }]);

  const gemini25Payload = client.toGeminiPayload(
    messages,
    [webSearchDefinition()],
    0.2,
    'gemini-2.5-flash'
  );
  assert.deepEqual(gemini25Payload.tools, [{ google_search: {} }]);

  const mixedGemini25Payload = client.toGeminiPayload(
    messages,
    [
      webSearchDefinition(),
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: 'Get current time.',
          parameters: { type: 'object', properties: {} }
        }
      }
    ],
    0.2,
    'gemini-2.5-flash'
  );
  assert.equal(mixedGemini25Payload.tools.length, 1);
  assert.equal(mixedGemini25Payload.tools[0].functionDeclarations[0].name, 'web_search');
});

test('explicit button input is handled before the natural chat agent', () => {
  const incomingHandler = extractBetween(
    telegramBotSource,
    '  async handleIncomingMessage(ctx) {',
    '\n  async prepareUserMessage'
  );

  assert.ok(
    incomingHandler.indexOf('this.takePendingMenuAction(ctx)') <
      incomingHandler.indexOf('tryHandleNaturalAgent(this, ctx)'),
    'pending tool input must run before the natural chat agent'
  );
});

test('Gemini defaults favor the current model and a larger conversation window', () => {
  const previous = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
    AI_FALLBACK_MODELS: process.env.AI_FALLBACK_MODELS,
    ENABLE_AI_ROUTER: process.env.ENABLE_AI_ROUTER,
    MAX_HISTORY_MESSAGES: process.env.MAX_HISTORY_MESSAGES
  };

  process.env.AI_PROVIDER = 'gemini';
  delete process.env.AI_MODEL;
  delete process.env.AI_FALLBACK_MODELS;
  delete process.env.ENABLE_AI_ROUTER;
  delete process.env.MAX_HISTORY_MESSAGES;

  try {
    const config = loadConfig();
    assert.equal(config.defaultModel, 'gemini-2.5-flash');
    assert.equal(config.enableAiRouter, false);
    assert.equal(config.maxHistoryMessages, 32);
    assert.equal(config.enableGeminiGoogleSearch, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tool registry exposes real weather lookup to the agent', () => {
  const registry = new ToolRegistry(
    {
      enableWebSearch: true,
      enableUrlFetch: true,
      enableToolCalls: true,
      toolAllowedNames: new Set(['get_weather']),
      toolAllowedUserIds: new Set(),
      toolAllowedChatIds: new Set(),
      toolBlockedUserIds: new Set(),
      toolAdminOnlyNames: new Set(),
      toolUserWindowMs: 60000,
      toolUserMaxCalls: 20,
      networkToolScope: 'all',
      networkToolAllowedUserIds: new Set(),
      networkToolAllowedChatIds: new Set()
    },
    logger()
  );

  const names = registry.getDefinitions().map((tool) => tool.function.name);
  assert.ok(names.includes('get_weather'));
});
