import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TelegramAIBot } from '../src/services/telegram-bot.js';
import { PlatformModesTelegramAIBot } from '../src/services/platform-modes-telegram-bot.js';
import { naturalAgentInternals } from '../src/services/natural-agent.js';
import { AIModelRouter } from '../src/services/ai-model-router.js';
import { AIProviderManager } from '../src/services/ai-provider-manager.js';

function createIncomingHarness({
  message = { text: 'Explain this system.' },
  settings = {
    providerId: 'auto',
    modelId: 'default-model',
    fallbackEnabled: false,
    rawProviderId: 'auto',
    rawModelId: '',
    manualProvider: false,
    manualModel: false,
    autoRouting: true
  },
  route = () => ({
    taskType: 'reasoning',
    provider: 'anthropic',
    model: 'claude-routed',
    confidence: 0.9,
    reason: 'reasoning request',
    fallbackModels: ['backup-model'],
    source: 'smart_router'
  }),
  preparedContent
} = {}) {
  const calls = {
    quota: 0,
    route: [],
    completions: [],
    replies: [],
    errors: []
  };
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = {
    aiProvider: 'gemini',
    defaultAIProvider: 'gemini',
    defaultModel: 'default-model',
    visionProvider: 'gemini',
    visionModel: 'vision-model',
    maxInputChars: 12000,
    maxOutputChars: 3500,
    maxHistoryMessages: 20,
    maxContextChars: 12000,
    enableToolCalls: false,
    enableProviderFallback: true,
    enableStreamingReplies: false,
    miniAppEnabled: true,
    groupTriggerMode: 'mention',
    groupTriggerKeyword: 'ai',
    adminUserIds: new Set(),
    systemPrompt: 'You are helpful.'
  };
  bot.db = {
    findUser: () => ({ id: '7', persona: 'default' }),
    findChat: () => ({ id: '8' }),
    getConversationForContext: () => [],
    incrementStats: async () => undefined,
    setConversation: async () => undefined,
    getLatestAssistantMessageReference: () => null
  };
  bot.logger = {
    warn: () => undefined,
    error: (...args) => calls.errors.push(args)
  };
  bot.aiModelRouter = {
    route(input) {
      calls.route.push(input);
      return route(input);
    }
  };
  bot.memoryManager = {
    getMemoryContext: () => null,
    updateAfterUserMessage: () => undefined,
    updateAfterAssistantReply: async () => undefined
  };
  bot.toolRegistry = {
    getDefinitions: () => [],
    execute: async () => undefined
  };
  bot.getLocale = () => 'en';
  bot.isAllowed = () => true;
  bot.checkRateLimit = () => true;
  bot.hasPendingMenuAction = () => false;
  bot.isBottomKeyboardActionText = () => false;
  bot.handleBottomKeyboardAction = async () => false;
  bot.takePendingMenuAction = () => null;
  bot.getActiveMode = () => null;
  bot.parseTranslationRequest = () => null;
  bot.parseNaturalLanguageAction = () => null;
  bot.consumeQuotaForContext = async () => {
    calls.quota += 1;
    return true;
  };
  bot.refundQuotaForContext = async () => undefined;
  bot.getEffectiveAISettings = () => settings;
  bot.prepareUserMessage = async () => ({
    message: {
      role: 'user',
      content: preparedContent ??
        (message.photo
          ? [
              { type: 'text', text: 'Describe this image.' },
              { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } }
            ]
          : message.document
            ? 'Attached file: report.pdf\n\nDocument body'
            : (message.voice || message.audio)
              ? 'Transcribed audio question'
              : message.text || message.caption || '')
    }
  });
  bot.buildMemoryEnhancedSystemPrompt = () => 'system';
  bot.completeWithAiFallback = async (options) => {
    calls.completions.push(options);
    return {
      result: {
        text: 'done',
        messages: [...options.request.messages, { role: 'assistant', content: 'done' }]
      },
      providerId: options.preferredProvider,
      model: options.model,
      switched: false
    };
  };
  bot.normalizeAiResult = (result) => result;
  bot.getAIProviderLabel = (providerId) => providerId;
  bot.sendAssistantReply = async () => ({ lastMessageId: null });
  bot.isAiQuotaError = () => false;
  bot.formatLogError = (error) => ({ name: error?.name || 'Error' });
  bot.formatUserFacingError = () => 'error';
  bot.t = (_locale, key) => key;

  const ctx = {
    from: { id: 7, language_code: 'en' },
    chat: { id: 8, type: 'private' },
    message: { message_id: 9, ...message },
    sendChatAction: async () => undefined,
    reply: async (...args) => calls.replies.push(args)
  };
  return { bot, calls, ctx };
}

test('automatic chat route is passed request-locally while fallback behavior stays enabled', async () => {
  const { bot, calls, ctx } = createIncomingHarness();

  await bot.handleIncomingMessage(ctx);

  assert.equal(calls.quota, 1);
  assert.equal(calls.route.length, 1);
  assert.equal(calls.completions.length, 1);
  assert.equal(calls.completions[0].preferredProvider, 'anthropic');
  assert.equal(calls.completions[0].model, 'claude-routed');
  assert.equal(calls.completions[0].fallbackEnabled, false);
  assert.equal(calls.route[0].text, 'Explain this system.');
  assert.equal(calls.route[0].mode, 'chat');
  assert.equal(calls.route[0].requiredCapability, 'chat');
  assert.equal(calls.route[0].allowToolCalls, false);
  assert.equal(calls.route[0].userId, '7');
  assert.equal(calls.route[0].chatId, '8');
  assert.equal(calls.route[0].userSettings.autoRouting, true);
  assert.equal(calls.route[0].conversationContext.historyMessageCount, 0);
  assert.equal(calls.errors.length, 0);
});

test('manual provider and model selections remain the preferred completion target', async () => {
  const settings = {
    providerId: 'openrouter',
    modelId: 'vendor/manual-model',
    fallbackEnabled: true,
    rawProviderId: 'openrouter',
    rawModelId: 'vendor/manual-model',
    manualProvider: true,
    manualModel: true,
    autoRouting: false
  };
  const { bot, calls, ctx } = createIncomingHarness({
    settings,
    route: (input) => ({
      taskType: 'general_chat',
      provider: input.userSettings.providerId,
      model: input.userSettings.modelId,
      confidence: 1,
      reason: 'manual override',
      fallbackModels: [],
      source: 'manual'
    })
  });

  await bot.handleIncomingMessage(ctx);

  assert.equal(calls.route[0].userSettings.manualProvider, true);
  assert.equal(calls.route[0].userSettings.manualModel, true);
  assert.equal(calls.completions[0].preferredProvider, 'openrouter');
  assert.equal(calls.completions[0].model, 'vendor/manual-model');
  assert.equal(calls.completions[0].fallbackEnabled, true);
});

test('router absence and exceptions fail open without logging request text', () => {
  const warnings = [];
  const base = {
    config: {
      defaultAIProvider: 'gemini',
      aiProvider: 'gemini',
      defaultModel: 'gemini-default'
    },
    logger: { warn: (...args) => warnings.push(args) }
  };
  const settings = {
    providerId: 'gemini',
    modelId: 'gemini-manual'
  };

  const unavailable = TelegramAIBot.prototype.resolveSmartModelRoute.call(
    { ...base, aiModelRouter: null },
    { settings, text: 'private prompt' }
  );
  assert.equal(unavailable.provider, 'gemini');
  assert.equal(unavailable.model, 'gemini-manual');
  assert.equal(warnings.length, 0);

  const failed = TelegramAIBot.prototype.resolveSmartModelRoute.call(
    {
      ...base,
      aiModelRouter: {
        route() {
          throw Object.assign(new Error('private prompt must not be logged'), { code: 'BROKEN_ROUTER' });
        }
      }
    },
    { settings, text: 'private prompt', mode: 'chat', userId: '7', chatId: '8' }
  );
  assert.equal(failed.provider, 'gemini');
  assert.equal(failed.model, 'gemini-manual');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], 'smart_router_default_fallback');
  assert.doesNotMatch(JSON.stringify(warnings[0]), /private prompt/);
});

test('photo and document requests carry distinct synchronous routing metadata', async () => {
  const photo = createIncomingHarness({
    message: { photo: [{ file_id: 'photo-1' }], caption: 'What is shown?' }
  });
  await photo.bot.handleIncomingMessage(photo.ctx);
  assert.equal(photo.calls.route[0].messageType, 'photo');
  assert.equal(photo.calls.route[0].attachmentType, 'photo');
  assert.equal(photo.calls.route[0].requiredCapability, 'vision');
  assert.deepEqual(photo.calls.route[0].modeSelection, {
    provider: 'gemini',
    model: 'vision-model'
  });
  assert.equal(photo.calls.completions[0].capability, 'vision');

  const document = createIncomingHarness({
    message: {
      document: {
        file_id: 'doc-1',
        file_name: 'report.pdf',
        mime_type: 'application/pdf'
      },
      caption: 'Summarize this.'
    }
  });
  await document.bot.handleIncomingMessage(document.ctx);
  assert.equal(document.calls.route[0].messageType, 'document');
  assert.equal(document.calls.route[0].attachmentType, 'document');
  assert.equal(document.calls.route[0].requiredCapability, 'chat');
  assert.equal(document.calls.route[0].conversationContext.documentMimeType, 'application/pdf');
  assert.equal(document.calls.completions[0].capability, 'chat');
});

test('transcribed audio is routed as text instead of another speech-to-text request', async () => {
  const audio = createIncomingHarness({
    message: { voice: { file_id: 'voice-1' } }
  });

  await audio.bot.handleIncomingMessage(audio.ctx);

  assert.equal(audio.calls.route[0].text, 'Transcribed audio question');
  assert.equal(audio.calls.route[0].messageType, 'text');
  assert.equal(audio.calls.route[0].attachmentType, 'transcribed_audio');
  assert.equal(audio.calls.route[0].requiredCapability, 'chat');
});

test('platform completion routes synchronously and preserves inline deadline controls', async () => {
  const sequence = [];
  const completions = [];
  const routeInputs = [];
  let quotaCalls = 0;
  const bot = Object.create(PlatformModesTelegramAIBot.prototype);
  bot.config = {
    defaultModel: 'base-model',
    aiProvider: 'gemini',
    defaultAIProvider: 'gemini',
    maxInputChars: 12000,
    maxOutputChars: 3500,
    enableToolCalls: false,
    adminUserIds: new Set(),
    systemPrompt: 'You are helpful.'
  };
  bot.db = {
    findUser: () => ({ id: '11', persona: 'default' }),
    incrementStats: async () => undefined
  };
  bot.logger = { warn: () => undefined };
  bot.getEffectiveAISettings = () => ({
    providerId: 'auto',
    modelId: 'base-model',
    fallbackEnabled: true,
    autoRouting: true
  });
  bot.aiModelRouter = {
    route(input) {
      sequence.push('route');
      routeInputs.push(input);
      return {
        taskType: 'code',
        provider: 'groq',
        model: 'routed-code-model',
        confidence: 0.95,
        reason: 'code',
        fallbackModels: [],
        source: 'smart_router'
      };
    }
  };
  bot.reserveUsageForUser = async () => {
    quotaCalls += 1;
    return { allowed: true };
  };
  bot.toolRegistry = { getDefinitions: () => [] };
  bot.completeWithAiFallback = async (options) => {
    sequence.push('complete');
    completions.push(options);
    return { result: { text: 'platform answer' } };
  };
  bot.normalizeAiResult = (result) => result;

  const controller = new AbortController();
  const answer = await bot.completePlatformRequest({
    userId: '11',
    chatId: '22',
    text: 'Fix this JavaScript function',
    scope: 'telegram_inline',
    fallbackEnabled: false,
    requestTimeoutMs: 417,
    signal: controller.signal,
    maxRetries: 0,
    accessAlreadyChecked: true,
    quotaAlreadyReserved: true
  });

  assert.equal(answer, 'platform answer');
  assert.deepEqual(sequence, ['route', 'complete']);
  assert.equal(quotaCalls, 0);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].preferredProvider, 'groq');
  assert.equal(completions[0].model, 'routed-code-model');
  assert.equal(completions[0].fallbackEnabled, false);
  assert.equal(completions[0].maxRetries, 0);
  assert.equal(completions[0].request.requestTimeoutMs, 417);
  assert.equal(completions[0].request.signal, controller.signal);
  assert.equal(completions[0].request.suppressTimeoutCooldown, true);
  assert.equal(routeInputs[0].mode, 'telegram_inline');
  assert.equal(routeInputs[0].userId, '11');
  assert.equal(routeInputs[0].chatId, '22');
});

test('inline cache fingerprint includes routing policy without invoking the router', () => {
  let routeCalls = 0;
  let currentSettings = {
    providerId: 'auto',
    modelId: 'default-model',
    rawProviderId: 'auto',
    rawModelId: '',
    manualProvider: false,
    manualModel: false,
    autoRouting: true,
    fallbackEnabled: true
  };
  const bot = Object.create(PlatformModesTelegramAIBot.prototype);
  bot.config = {
    smartRoutingEnabled: true,
    smartRoutingMinConfidence: 0.55,
    smartRoutingModels: { code: 'code-a' },
    smartRoutingProviders: { code: 'groq' }
  };
  bot.db = { findUser: () => ({ persona: 'default' }) };
  bot.getEffectiveAISettings = () => currentSettings;
  bot.aiModelRouter = {
    version: 'policy-1',
    route() {
      routeCalls += 1;
    }
  };

  const first = bot.getInlineCacheFingerprint('7', 'en', { query: 'code', kind: 'answer' });
  bot.config.smartRoutingModels = { code: 'code-b' };
  const second = bot.getInlineCacheFingerprint('7', 'en', { query: 'code', kind: 'answer' });
  bot.aiModelRouter.version = 'policy-2';
  const third = bot.getInlineCacheFingerprint('7', 'en', { query: 'code', kind: 'answer' });
  currentSettings = {
    ...currentSettings,
    rawModelId: 'default-model',
    manualModel: true,
    autoRouting: false
  };
  const fourth = bot.getInlineCacheFingerprint('7', 'en', { query: 'code', kind: 'answer' });

  assert.notEqual(first, second);
  assert.notEqual(second, third);
  assert.notEqual(third, fourth);
  assert.equal(routeCalls, 0);
});

test('natural web result composition uses the Smart tool route without another router model call', async () => {
  const routeInputs = [];
  const completions = [];
  const bot = {
    config: {
      aiProvider: 'gemini',
      defaultModel: 'default-model',
      enableProviderFallback: true,
      maxOutputChars: 3500
    },
    db: {
      getConversationForContext: () => [],
      findUser: () => ({ persona: 'default' })
    },
    getLocale: () => 'en',
    getEffectiveAISettings: () => ({
      providerId: 'auto',
      modelId: 'default-model',
      rawProviderId: 'auto',
      rawModelId: '',
      manualProvider: false,
      manualModel: false,
      autoRouting: true,
      fallbackEnabled: true
    }),
    resolveSmartModelRoute(input) {
      routeInputs.push(input);
      return {
        taskType: 'web_research',
        provider: 'openrouter',
        model: 'tool-model',
        source: 'smart'
      };
    },
    completeWithAiFallback: async (options) => {
      completions.push(options);
      return { result: { text: 'Fresh answer' } };
    }
  };
  const ctx = {
    from: { id: 7 },
    chat: { id: 8 }
  };

  const answer = await naturalAgentInternals.composeHumanAnswer(bot, ctx, {
    userText: 'today news',
    toolName: 'web_search',
    raw: JSON.stringify({
      results: [{
        title: 'Current report',
        description: 'Fresh verified information',
        url: 'https://example.com/report'
      }]
    }),
    title: 'Web results'
  });

  assert.equal(answer, 'Fresh answer');
  assert.equal(routeInputs.length, 1);
  assert.equal(routeInputs[0].mode, 'web_research');
  assert.equal(routeInputs[0].conversationContext.hasRetrievedContext, true);
  assert.equal(routeInputs[0].requiredCapability, 'chat');
  assert.equal(routeInputs[0].allowToolCalls, false);
  assert.equal(completions[0].preferredProvider, 'openrouter');
  assert.equal(completions[0].model, 'tool-model');
});

test('native Gemini search never overrides a manual non-Gemini target', async (t) => {
  const cases = [
    {
      name: 'fixed provider and model',
      settings: {
        providerId: 'openrouter',
        modelId: 'manual-tool-model',
        rawProviderId: 'openrouter',
        rawModelId: 'manual-tool-model',
        manualProvider: true,
        manualModel: true,
        autoRouting: false,
        fallbackEnabled: false
      }
    },
    {
      name: 'fixed model under auto provider',
      settings: {
        providerId: 'auto',
        modelId: 'manual-tool-model',
        rawProviderId: 'auto',
        rawModelId: 'manual-tool-model',
        manualProvider: false,
        manualModel: true,
        autoRouting: false,
        fallbackEnabled: false
      }
    }
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      let nativeGeminiCalls = 0;
      let genericSearchCalls = 0;
      const replies = [];
      const rows = [
        {
          id: 'gemini',
          configured: true,
          enabled: true,
          capabilities: { chat: true, toolCalls: true },
          models: ['gemini-search-model']
        },
        {
          id: 'openrouter',
          configured: true,
          enabled: true,
          capabilities: { chat: true, toolCalls: true },
          models: ['manual-tool-model']
        }
      ];
      const bot = Object.create(TelegramAIBot.prototype);
      bot.config = {
        aiProvider: 'gemini',
        defaultAIProvider: 'gemini',
        defaultModel: 'gemini-search-model',
        providerModels: {
          gemini: ['gemini-search-model'],
          openrouter: ['manual-tool-model']
        },
        smartRoutingEnabled: true,
        smartRoutingDebug: false,
        smartRoutingMinConfidence: 0.55,
        smartRoutingProviders: { tool: 'gemini' },
        smartRoutingModels: { tool: 'gemini-search-model' },
        enableWebSearch: true,
        enableGeminiGoogleSearch: true,
        enableProviderFallback: true,
        maxOutputChars: 3500,
        maxHistoryMessages: 20,
        adminUserIds: new Set()
      };
      bot.providerManager = {
        listProviders: () => rows,
        getProviderModels: (providerId) =>
          rows.find((row) => row.id === providerId)?.models || [],
        getProviderCapabilities: (providerId) =>
          rows.find((row) => row.id === providerId)?.capabilities || {},
        isConfigured: (providerId) =>
          rows.find((row) => row.id === providerId)?.configured === true,
        isEnabled: (providerId) =>
          rows.find((row) => row.id === providerId)?.enabled !== false
      };
      bot.aiModelRouter = new AIModelRouter({
        config: bot.config,
        providerManager: bot.providerManager,
        logger: { debug() {}, info() {}, warn() {} }
      });
      bot.aiClient = {
        searchWeb: async () => {
          nativeGeminiCalls += 1;
          return { text: 'must not run' };
        }
      };
      bot.getLocale = () => 'en';
      bot.getEffectiveAISettings = () => item.settings;
      bot.consumeQuotaForContext = async () => true;
      bot.toolRegistry = {
        execute: async () => {
          genericSearchCalls += 1;
          return JSON.stringify({
            results: [{
              title: 'Fresh result',
              description: 'Current information',
              url: 'https://example.com/current'
            }]
          });
        }
      };
      bot.composeToolReply = async () => ({ text: 'Current answer', html: false });
      bot.db = {
        findUser: () => ({ id: '7' }),
        incrementStats: async () => undefined,
        getConversation: () => [],
        setConversation: async () => undefined
      };
      bot.logger = { warn() {} };
      bot.formatUserFacingError = () => 'error';
      const ctx = {
        from: { id: 7 },
        chat: { id: 8, type: 'private' },
        message: { text: 'Search current information' },
        sendChatAction: async () => undefined,
        reply: async (...args) => replies.push(args)
      };

      await bot.runWebSearch(ctx, 'current information');

      assert.equal(nativeGeminiCalls, 0);
      assert.equal(genericSearchCalls, 1);
      assert.equal(replies[0][0], 'Current answer');
    });
  }
});

test('a truly automatic user keeps native Gemini search when the server default is auto', async () => {
  let nativeGeminiCalls = 0;
  let genericSearchCalls = 0;
  const replies = [];
  const rows = [{
    id: 'gemini',
    configured: true,
    enabled: true,
    capabilities: { chat: true, toolCalls: true },
    models: ['gemini-search-model']
  }];
  const bot = Object.create(TelegramAIBot.prototype);
  bot.config = {
    aiProvider: 'auto',
    defaultAIProvider: 'auto',
    defaultModel: 'gemini-search-model',
    availableModels: ['gemini-search-model'],
    providerModels: {
      auto: ['gemini-search-model'],
      gemini: ['gemini-search-model']
    },
    smartRoutingEnabled: true,
    smartRoutingDebug: false,
    smartRoutingMinConfidence: 0.55,
    smartRoutingProviders: {},
    smartRoutingModels: {},
    enableWebSearch: true,
    enableGeminiGoogleSearch: true,
    enableProviderFallback: true,
    maxOutputChars: 3500,
    maxHistoryMessages: 20,
    adminUserIds: new Set()
  };
  bot.providerManager = {
    listProviders: () => rows,
    getProviderModels: (providerId) =>
      rows.find((row) => row.id === providerId)?.models || [],
    getProviderCapabilities: (providerId) =>
      rows.find((row) => row.id === providerId)?.capabilities || {},
    isConfigured: (providerId) =>
      rows.find((row) => row.id === providerId)?.configured === true,
    isEnabled: (providerId) =>
      rows.find((row) => row.id === providerId)?.enabled !== false
  };
  bot.aiModelRouter = new AIModelRouter({
    config: bot.config,
    providerManager: bot.providerManager,
    logger: { debug() {}, info() {}, warn() {} }
  });
  bot.aiClient = {
    searchWeb: async ({ model }) => {
      nativeGeminiCalls += 1;
      assert.equal(model, 'gemini-search-model');
      return { text: 'Grounded current answer' };
    }
  };
  bot.getLocale = () => 'en';
  bot.getEffectiveAISettings = () => ({
    providerId: 'auto',
    modelId: 'gemini-search-model',
    rawProviderId: 'auto',
    rawModelId: '',
    manualProvider: false,
    manualModel: false,
    autoRouting: true,
    fallbackEnabled: true
  });
  bot.consumeQuotaForContext = async () => true;
  bot.toolRegistry = {
    execute: async () => {
      genericSearchCalls += 1;
      return '';
    }
  };
  bot.db = {
    findUser: () => ({ id: '7' }),
    incrementStats: async () => undefined,
    getConversation: () => [],
    setConversation: async () => undefined
  };
  bot.logger = { warn() {} };
  bot.formatUserFacingError = () => 'error';
  const ctx = {
    from: { id: 7 },
    chat: { id: 8, type: 'private' },
    message: { text: 'Search current information' },
    sendChatAction: async () => undefined,
    reply: async (...args) => replies.push(args)
  };

  await bot.runWebSearch(ctx, 'current information');

  assert.equal(nativeGeminiCalls, 1);
  assert.equal(genericSearchCalls, 0);
  assert.match(replies[0][0], /Grounded current answer/);
});

test('a Smart-selected model failure still uses the existing ProviderManager fallback chain', async () => {
  const attempts = [];
  const config = {
    aiProvider: 'auto',
    defaultAIProvider: 'auto',
    defaultModel: 'default-model',
    availableModels: ['default-model'],
    providerModels: {
      groq: ['routed-model'],
      gemini: ['fallback-model']
    },
    providerDefaultModels: {},
    groqApiKey: 'test-groq-key',
    geminiApiKey: 'test-gemini-key',
    aiProviderFallbackOrder: ['gemini'],
    enableProviderFallback: true,
    aiProviderMaxRetries: 0,
    aiProviderRetryDelayMs: 0,
    aiProviderCooldownMs: 1000,
    smartRoutingEnabled: true,
    smartRoutingDebug: false,
    smartRoutingMinConfidence: 0.55,
    smartRoutingProviders: { general: 'groq' },
    smartRoutingModels: { general: 'routed-model' }
  };
  const logger = { debug() {}, info() {}, warn() {} };
  const manager = new AIProviderManager({
    config,
    logger,
    clientFactory: (providerConfig) => ({
      getProviderName: () => providerConfig.aiProvider,
      getCapabilities: () => ({ chat: true, toolCalls: true }),
      completeWithTools: async ({ model }) => {
        attempts.push(`${providerConfig.aiProvider}:${model}`);
        if (providerConfig.aiProvider === 'groq') {
          throw new Error('AI request failed (503): temporary');
        }
        return { text: 'fallback worked' };
      }
    })
  });
  const router = new AIModelRouter({ config, providerManager: manager, logger });
  const route = router.route({
    text: 'Hello',
    messageType: 'text',
    requiredCapability: 'chat',
    userSettings: {
      providerId: 'auto',
      modelId: 'default-model',
      rawProviderId: 'auto',
      rawModelId: '',
      manualProvider: false,
      manualModel: false,
      autoRouting: true
    }
  });

  assert.equal(route.provider, 'groq');
  assert.equal(route.model, 'routed-model');

  const completion = await manager.execute({
    capability: 'chat',
    preferredProvider: route.provider,
    preferredModel: route.model,
    fallbackEnabled: true,
    maxRetries: 0,
    request: {
      messages: [{ role: 'user', content: 'Hello' }],
      tools: []
    }
  });

  assert.equal(completion.providerId, 'gemini');
  assert.equal(completion.model, 'fallback-model');
  assert.deepEqual(attempts, ['groq:routed-model', 'gemini:fallback-model']);
});

test('translation entry points route locally while privacy and admin tests stay isolated', () => {
  const telegramSource = fs.readFileSync('src/services/telegram-bot.js', 'utf8');
  const platformSource = fs.readFileSync('src/services/platform-modes-telegram-bot.js', 'utf8');
  const privacySource = fs.readFileSync('src/services/privacy-telegram-bot.js', 'utf8');
  const between = (source, start, end) => {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `missing ${start}`);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `missing ${end}`);
    return source.slice(startIndex, endIndex);
  };

  const translation = between(
    telegramSource,
    "  async runTranslation(ctx, text = '', targetLanguage = 'auto') {",
    '\n  normalizeLanguageInput'
  );
  const aiSettingsCallback = between(
    telegramSource,
    '  async handleAISettingsCallback(ctx) {',
    '\n  async handleModelCallback'
  );
  const inlineTranslation = between(
    platformSource,
    '  async completeInlineTranslation({',
    '\n  async refundPlatformQuotaReservation'
  );

  assert.match(translation, /resolveSmartModelRoute/);
  assert.doesNotMatch(aiSettingsCallback, /resolveSmartModelRoute/);
  assert.match(inlineTranslation, /resolveSmartModelRoute/);
  assert.doesNotMatch(privacySource, /resolveSmartModelRoute/);
});
