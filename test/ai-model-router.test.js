import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIModelRouter,
  SMART_ROUTER_POLICY_VERSION,
  SMART_ROUTER_TASK_TYPES,
  classifyTask
} from '../src/services/ai-model-router.js';

function routingConfig(overrides = {}) {
  return {
    smartRoutingEnabled: true,
    smartRoutingDebug: true,
    smartRoutingMinConfidence: 0.55,
    smartRoutingProviders: {
      general: 'openai-compatible',
      translation: 'openai-compatible',
      code: 'openai-compatible',
      reasoning: 'openai-compatible',
      long_context: 'openai-compatible',
      document: 'openai-compatible',
      vision: 'vision-provider',
      ocr: 'vision-provider',
      tool: 'tool-provider',
      cheap: 'cheap-provider'
    },
    smartRoutingModels: {
      general: 'general-model',
      translation: 'translation-model',
      code: 'code-model',
      reasoning: 'reasoning-model',
      long_context: 'long-model',
      document: 'document-model',
      vision: 'vision-model',
      ocr: 'ocr-model',
      tool: 'tool-model',
      cheap: 'cheap-model'
    },
    defaultAIProvider: 'openai-compatible',
    aiProvider: 'openai-compatible',
    defaultModel: 'default-model',
    imageProvider: 'media-provider',
    imageModel: 'image-model',
    transcriptionProvider: 'media-provider',
    transcriptionModel: 'stt-model',
    ttsProvider: 'media-provider',
    ttsModel: 'tts-model',
    providerModels: {
      'openai-compatible': [
        'default-model',
        'general-model',
        'translation-model',
        'code-model',
        'reasoning-model',
        'long-model',
        'document-model'
      ],
      'vision-provider': ['vision-model', 'ocr-model'],
      'tool-provider': ['tool-model'],
      'cheap-provider': ['cheap-model'],
      'media-provider': ['image-model', 'stt-model', 'tts-model'],
      'gemini-live': ['live-model']
    },
    ...overrides
  };
}

function providers(overrides = {}) {
  const rows = {
    'openai-compatible': {
      id: 'openai-compatible',
      configured: true,
      enabled: true,
      capabilities: { chat: true, toolCalls: true, vision: true },
      models: routingConfig().providerModels['openai-compatible']
    },
    'vision-provider': {
      id: 'vision-provider',
      configured: true,
      enabled: true,
      capabilities: { chat: true, vision: true },
      models: ['vision-model', 'ocr-model']
    },
    'tool-provider': {
      id: 'tool-provider',
      configured: true,
      enabled: true,
      capabilities: { chat: true, toolCalls: true },
      models: ['tool-model']
    },
    'cheap-provider': {
      id: 'cheap-provider',
      configured: true,
      enabled: true,
      capabilities: { chat: true },
      models: ['cheap-model']
    },
    'media-provider': {
      id: 'media-provider',
      configured: true,
      enabled: true,
      capabilities: {
        chat: true,
        imageGeneration: true,
        speechTranscription: true,
        speechSynthesis: true
      },
      models: ['image-model', 'stt-model', 'tts-model']
    },
    'gemini-live': {
      id: 'gemini-live',
      configured: true,
      enabled: true,
      capabilities: {
        chat: true,
        liveAudio: true,
        speechTranscription: true,
        speechSynthesis: true
      },
      models: ['live-model']
    },
    ...overrides
  };
  return Object.values(rows);
}

function createRouter({ config = routingConfig(), rows = providers(), logger, db } = {}) {
  return new AIModelRouter({
    config,
    logger: logger || { debug() {}, info() {}, warn() {} },
    db,
    providerManager: {
      listProviders: () => rows,
      getProviderModels: (providerId) =>
        rows.find((row) => row.id === providerId)?.models || config.providerModels?.[providerId] || [],
      getProviderCapabilities: (providerId) =>
        rows.find((row) => row.id === providerId)?.capabilities || {},
      isConfigured: (providerId) =>
        rows.find((row) => row.id === providerId)?.configured === true,
      isEnabled: (providerId) =>
        rows.find((row) => row.id === providerId)?.enabled !== false
    }
  });
}

function autoInput(input = {}) {
  return {
    messageType: 'text',
    userSettings: {
      providerId: 'auto',
      modelId: 'default-model',
      rawProviderId: 'auto',
      rawModelId: '',
      manualProvider: false,
      manualModel: false,
      autoRouting: true
    },
    ...input
  };
}

test('Smart Router exposes every required V1 task type', () => {
  for (const taskType of [
    'general_chat',
    'translation',
    'coding',
    'debugging',
    'reasoning',
    'long_context',
    'document_analysis',
    'summarization',
    'vision',
    'ocr',
    'image_generation',
    'speech_to_text',
    'text_to_speech',
    'live_voice',
    'web_research',
    'tool_calling',
    'cheap_fallback'
  ]) {
    assert.ok(SMART_ROUTER_TASK_TYPES.includes(taskType), taskType);
  }
});

test('ordinary chat selects the configured general model', () => {
  const route = createRouter().route(autoInput({ text: 'Hello, how are you?' }));
  assert.equal(route.taskType, 'general_chat');
  assert.equal(route.provider, 'openai-compatible');
  assert.equal(route.model, 'general-model');
  assert.equal(route.source, 'smart');
});

test('translation requests select the translation model', () => {
  const route = createRouter().route(autoInput({ text: 'Translate this into Japanese: good morning' }));
  assert.equal(route.taskType, 'translation');
  assert.equal(route.model, 'translation-model');
});

test('code fences select the code model', () => {
  const route = createRouter().route(autoInput({ text: 'Review this:\n```js\nconst value = 1;\n```' }));
  assert.equal(route.taskType, 'coding');
  assert.equal(route.model, 'code-model');
});

test('error logs select the debugging task before coding', () => {
  const route = createRouter().route(autoInput({
    text: 'TypeError: value is undefined\n    at run (app.js:10:3)'
  }));
  assert.equal(route.taskType, 'debugging');
  assert.equal(route.model, 'code-model');
});

test('mathematical analysis selects the reasoning model', () => {
  const route = createRouter().route(autoInput({ text: 'Prove this probability equation step by step.' }));
  assert.equal(route.taskType, 'reasoning');
  assert.equal(route.model, 'reasoning-model');
});

test('long text selects the long-context model', () => {
  const route = createRouter().route(autoInput({ text: 'a'.repeat(7000) }));
  assert.equal(route.taskType, 'long_context');
  assert.equal(route.model, 'long-model');
});

test('conversation context length can trigger long-context routing', () => {
  const route = createRouter().route(autoInput({
    text: 'continue',
    conversationContext: { historyChars: 9000 }
  }));
  assert.equal(route.taskType, 'long_context');
});

test('PDF attachments select the document model', () => {
  const route = createRouter().route(autoInput({
    text: 'Analyze the clauses',
    messageType: 'document',
    attachmentType: 'application/pdf'
  }));
  assert.equal(route.taskType, 'document_analysis');
  assert.equal(route.model, 'document-model');
});

test('document summary requests classify as summarization', () => {
  const result = classifyTask({
    text: 'Summarize the key points',
    messageType: 'document',
    attachmentType: 'pdf'
  });
  assert.equal(result.taskType, 'summarization');
});

test('image attachments select the vision model', () => {
  const route = createRouter().route(autoInput({
    text: 'What is in this photo?',
    messageType: 'photo',
    attachmentType: 'image'
  }));
  assert.equal(route.taskType, 'vision');
  assert.equal(route.provider, 'vision-provider');
  assert.equal(route.model, 'vision-model');
});

test('OCR requests select the OCR model', () => {
  const route = createRouter().route(autoInput({
    text: 'Extract the text from this screenshot',
    messageType: 'photo',
    attachmentType: 'image'
  }));
  assert.equal(route.taskType, 'ocr');
  assert.equal(route.model, 'ocr-model');
});

test('image generation selects the dedicated image provider', () => {
  const route = createRouter().route(autoInput({ text: 'Generate an image of a mountain lake.' }));
  assert.equal(route.taskType, 'image_generation');
  assert.equal(route.provider, 'media-provider');
  assert.equal(route.model, 'image-model');
});

test('audio attachments classify as speech to text', () => {
  const route = createRouter().route(autoInput({
    text: '',
    messageType: 'voice',
    attachmentType: 'audio'
  }));
  assert.equal(route.taskType, 'speech_to_text');
  assert.equal(route.model, 'stt-model');
});

test('TTS requests select the speech synthesis model', () => {
  const route = createRouter().route(autoInput({ text: 'Please read this aloud.' }));
  assert.equal(route.taskType, 'text_to_speech');
  assert.equal(route.model, 'tts-model');
});

test('live voice selects Gemini Live only for live audio tasks', () => {
  const route = createRouter().route(autoInput({ text: 'Start a real-time voice conversation.' }));
  assert.equal(route.taskType, 'live_voice');
  assert.equal(route.provider, 'gemini-live');
  assert.equal(route.model, 'live-model');
});

test('normal text never selects Gemini Live', () => {
  const config = routingConfig({
    smartRoutingProviders: { ...routingConfig().smartRoutingProviders, general: 'gemini-live' },
    smartRoutingModels: { ...routingConfig().smartRoutingModels, general: 'live-model' },
    defaultAIProvider: 'openai-compatible'
  });
  const route = createRouter({ config }).route(autoInput({ text: 'Hello' }));
  assert.notEqual(route.provider, 'gemini-live');
  assert.equal(route.provider, 'openai-compatible');
});

test('web research selects a tool-capable model', () => {
  const route = createRouter().route(autoInput({ text: 'Search today’s latest technology news.' }));
  assert.equal(route.taskType, 'web_research');
  assert.equal(route.provider, 'tool-provider');
  assert.equal(route.model, 'tool-model');
});

test('explicit tool requests classify as tool calling', () => {
  const route = createRouter().route(autoInput({ text: 'Use a tool to inspect this value.' }));
  assert.equal(route.taskType, 'tool_calling');
  assert.equal(route.model, 'tool-model');
});

test('low-cost requests select the cheap model', () => {
  const route = createRouter().route(autoInput({ text: 'Use the lowest cost model for this short answer.' }));
  assert.equal(route.taskType, 'cheap_fallback');
  assert.equal(route.provider, 'cheap-provider');
  assert.equal(route.model, 'cheap-model');
});

test('a manually selected model overrides automatic routing', () => {
  const route = createRouter().route({
    text: 'Translate this into Chinese',
    userSettings: {
      providerId: 'openai-compatible',
      modelId: 'code-model',
      rawProviderId: 'openai-compatible',
      rawModelId: 'code-model',
      manualProvider: true,
      manualModel: true,
      autoRouting: false
    }
  });
  assert.equal(route.taskType, 'translation');
  assert.equal(route.provider, 'openai-compatible');
  assert.equal(route.model, 'code-model');
  assert.equal(route.source, 'manual_model');
});

test('a manually selected provider overrides automatic provider routing', () => {
  const route = createRouter().route({
    text: 'Search the latest news',
    userSettings: {
      providerId: 'openai-compatible',
      modelId: 'default-model',
      rawProviderId: 'openai-compatible',
      rawModelId: '',
      manualProvider: true,
      manualModel: false,
      autoRouting: false
    }
  });
  assert.equal(route.provider, 'openai-compatible');
  assert.equal(route.model, 'default-model');
  assert.equal(route.source, 'manual_provider');
});

test('manual model and provider are never replaced after a capability mismatch', () => {
  const rows = providers({
    'manual-provider': {
      id: 'manual-provider',
      configured: true,
      enabled: true,
      capabilities: { chat: true, vision: false },
      models: ['manual-text-model']
    }
  });
  const route = createRouter({ rows }).route({
    text: 'Describe this photo',
    messageType: 'photo',
    attachmentType: 'image',
    requiredCapability: 'vision',
    userSettings: {
      providerId: 'manual-provider',
      modelId: 'manual-text-model',
      rawProviderId: 'manual-provider',
      rawModelId: 'manual-text-model',
      manualProvider: true,
      manualModel: true,
      autoRouting: false,
      fallbackEnabled: false
    }
  });
  assert.equal(route.provider, 'manual-provider');
  assert.equal(route.model, 'manual-text-model');
  assert.equal(route.source, 'manual_model');
});

test('an unavailable manual provider is left for the existing fallback manager to handle', () => {
  const rows = providers({
    'manual-provider': {
      id: 'manual-provider',
      configured: false,
      enabled: true,
      capabilities: { chat: true },
      models: ['manual-model']
    }
  });
  const route = createRouter({ rows }).route({
    text: 'Search the latest news',
    userSettings: {
      providerId: 'manual-provider',
      modelId: 'manual-model',
      rawProviderId: 'manual-provider',
      rawModelId: 'manual-model',
      manualProvider: true,
      manualModel: true,
      autoRouting: false,
      fallbackEnabled: false
    }
  });
  assert.equal(route.provider, 'manual-provider');
  assert.equal(route.model, 'manual-model');
  assert.equal(route.source, 'manual_model');
});

test('a fixed manual model under auto provider resolves its owning provider', () => {
  const route = createRouter().route({
    text: 'Hello',
    userSettings: {
      providerId: 'auto',
      modelId: 'cheap-model',
      rawProviderId: 'auto',
      rawModelId: 'cheap-model',
      manualProvider: false,
      manualModel: true,
      autoRouting: false
    }
  });
  assert.equal(route.provider, 'cheap-provider');
  assert.equal(route.model, 'cheap-model');
  assert.equal(route.source, 'manual_model');
});

test('mode selection has priority over the Smart task target', () => {
  const route = createRouter().route(autoInput({
    text: 'Hello',
    modeSelection: {
      provider: 'cheap-provider',
      model: 'cheap-model'
    }
  }));
  assert.equal(route.provider, 'cheap-provider');
  assert.equal(route.model, 'cheap-model');
  assert.equal(route.source, 'mode');
});

test('an unavailable mode target is left for the existing fallback manager to handle', () => {
  const rows = providers({
    'mode-provider': {
      id: 'mode-provider',
      configured: false,
      enabled: true,
      capabilities: { chat: true, vision: true },
      models: ['mode-model']
    }
  });
  const route = createRouter({ rows }).route(autoInput({
    text: 'Describe this image',
    messageType: 'photo',
    attachmentType: 'image',
    requiredCapability: 'vision',
    modeSelection: {
      provider: 'mode-provider',
      model: 'mode-model'
    },
    userSettings: {
      providerId: 'auto',
      modelId: 'default-model',
      rawProviderId: 'auto',
      rawModelId: '',
      manualProvider: false,
      manualModel: false,
      autoRouting: true,
      fallbackEnabled: false
    }
  }));
  assert.equal(route.provider, 'mode-provider');
  assert.equal(route.model, 'mode-model');
  assert.equal(route.source, 'mode');
});

test('disabled Smart routing uses the original default target', () => {
  const config = routingConfig({ smartRoutingEnabled: false });
  const route = createRouter({ config }).route(autoInput({ text: 'Translate this to English' }));
  assert.equal(route.taskType, 'translation');
  assert.equal(route.provider, 'openai-compatible');
  assert.equal(route.model, 'default-model');
  assert.equal(route.reason, 'smart_routing_disabled');
});

test('disabled Smart routing preserves auto for ProviderManager fallback ordering', () => {
  const config = routingConfig({
    smartRoutingEnabled: false,
    defaultAIProvider: 'auto',
    aiProvider: 'auto',
    defaultModel: 'unowned-default'
  });
  const rows = [
    {
      id: 'anthropic',
      configured: true,
      enabled: true,
      capabilities: { chat: true },
      models: ['anthropic-model']
    },
    {
      id: 'gemini',
      configured: true,
      enabled: true,
      capabilities: { chat: true },
      models: ['gemini-model']
    }
  ];
  const route = createRouter({ config, rows }).route(autoInput({ text: 'Hello' }));
  assert.equal(route.provider, 'auto');
  assert.equal(route.model, 'unowned-default');
  assert.equal(route.source, 'default');
});

test('blank task provider under a fixed default keeps duplicate model ownership deterministic', () => {
  const base = routingConfig();
  const config = routingConfig({
    smartRoutingProviders: { ...base.smartRoutingProviders, code: '' },
    smartRoutingModels: { ...base.smartRoutingModels, code: 'shared-model' },
    defaultAIProvider: 'openai-compatible',
    aiProvider: 'openai-compatible',
    providerModels: {
      ...base.providerModels,
      openai: ['shared-model'],
      'openai-compatible': [...base.providerModels['openai-compatible'], 'shared-model']
    }
  });
  const rows = [
    {
      id: 'openai',
      configured: true,
      enabled: true,
      capabilities: { chat: true },
      models: ['shared-model']
    },
    {
      id: 'openai-compatible',
      configured: true,
      enabled: true,
      capabilities: { chat: true, toolCalls: true, vision: true },
      models: config.providerModels['openai-compatible']
    }
  ];
  const route = createRouter({ config, rows }).route(autoInput({
    text: 'Review this JavaScript code'
  }));
  assert.equal(route.provider, 'openai-compatible');
  assert.equal(route.model, 'shared-model');
});

test('chat execution never sends an image-generation request to a media model', () => {
  const route = createRouter().route(autoInput({
    text: 'Generate an image of a mountain lake.',
    requiredCapability: 'chat'
  }));
  assert.equal(route.taskType, 'image_generation');
  assert.equal(route.provider, 'openai-compatible');
  assert.equal(route.model, 'general-model');
});

test('retrieved web context can be composed by a chat-only manual model', () => {
  const rows = providers({
    'chat-only': {
      id: 'chat-only',
      configured: true,
      enabled: true,
      capabilities: { chat: true, toolCalls: false },
      models: ['chat-only-model']
    }
  });
  const route = createRouter({ rows }).route({
    text: 'Summarize today’s news',
    mode: 'web_research',
    requiredCapability: 'chat',
    allowToolCalls: false,
    conversationContext: { hasRetrievedContext: true },
    userSettings: {
      providerId: 'chat-only',
      modelId: 'chat-only-model',
      rawProviderId: 'chat-only',
      rawModelId: 'chat-only-model',
      manualProvider: true,
      manualModel: true,
      autoRouting: false
    }
  });
  assert.equal(route.provider, 'chat-only');
  assert.equal(route.model, 'chat-only-model');
});

test('an unconfigured provider cannot be selected', () => {
  const rows = providers({
    'tool-provider': {
      id: 'tool-provider',
      configured: false,
      enabled: true,
      capabilities: { chat: true, toolCalls: true },
      models: ['tool-model']
    }
  });
  const route = createRouter({ rows }).route(autoInput({ text: 'Search the latest news' }));
  assert.notEqual(route.provider, 'tool-provider');
  assert.equal(route.provider, 'openai-compatible');
});

test('a disabled provider cannot be selected', () => {
  const rows = providers({
    'cheap-provider': {
      id: 'cheap-provider',
      configured: true,
      enabled: false,
      capabilities: { chat: true },
      models: ['cheap-model']
    }
  });
  const route = createRouter({ rows }).route(autoInput({ text: 'Use the cheapest model' }));
  assert.notEqual(route.provider, 'cheap-provider');
});

test('a model with an explicit capability mismatch is rejected', () => {
  const route = createRouter().route(autoInput({
    text: 'Read this image',
    messageType: 'photo',
    attachmentType: 'image',
    availableModels: {
      'vision-provider': [
        {
          id: 'vision-model',
          capabilities: { vision: false }
        },
        {
          id: 'ocr-model',
          capabilities: { vision: true }
        }
      ]
    }
  }));
  assert.notEqual(route.model, 'vision-model');
  assert.equal(route.model, 'ocr-model');
});

test('a model that cannot hold the context is rejected', () => {
  const route = createRouter().route(autoInput({
    text: 'x'.repeat(7000),
    availableModels: {
      'openai-compatible': [
        {
          id: 'long-model',
          capabilities: { chat: true },
          contextWindow: 100
        },
        {
          id: 'default-model',
          capabilities: { chat: true },
          contextWindow: 10000
        }
      ]
    }
  }));
  assert.notEqual(route.model, 'long-model');
  assert.equal(route.model, 'default-model');
});

test('missing task models safely fall back to the default model', () => {
  const config = routingConfig({
    smartRoutingModels: { ...routingConfig().smartRoutingModels, code: 'missing-model' }
  });
  const route = createRouter({ config }).route(autoInput({ text: '```js\nconst a = 1\n```' }));
  assert.equal(route.provider, 'openai-compatible');
  assert.equal(route.model, 'default-model');
  assert.equal(route.source, 'smart');
});

test('AI Hub works as an OpenAI-compatible provider with multiple configured models', () => {
  const route = createRouter().route(autoInput({ text: 'Review this code function' }));
  assert.equal(route.provider, 'openai-compatible');
  assert.equal(route.model, 'code-model');
});

test('optional database metadata can disable an already configured route model', () => {
  const router = createRouter({
    db: {
      listModelConfigs: () => [{
        modelId: 'code-model',
        providerId: 'openai-compatible',
        enabled: false,
        meta: {}
      }]
    }
  });
  const route = router.route(autoInput({ text: 'Review this code' }));
  assert.notEqual(route.model, 'code-model');
});

test('route logs contain safe metadata but not API keys or full message text', () => {
  const logs = [];
  const secret = 'secret-api-key-value';
  const prompt = 'private-message-body-that-must-not-be-logged';
  const config = routingConfig({ aiApiKey: secret, smartRoutingDebug: true });
  const logger = {
    debug: (event, meta) => logs.push({ event, meta }),
    info: (event, meta) => logs.push({ event, meta }),
    warn: (event, meta) => logs.push({ event, meta })
  };
  const route = createRouter({ config, logger }).route(autoInput({
    text: prompt,
    userId: '42',
    chatId: '99'
  }));
  const serialized = JSON.stringify(logs);
  assert.equal(route.provider, 'openai-compatible');
  assert.match(serialized, /smart_router_selected/);
  assert.match(serialized, /"textLength":/);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(prompt));
  assert.equal(logs[0].meta.policyVersion, SMART_ROUTER_POLICY_VERSION);
});

test('selection logs stay quiet unless Smart routing debug is enabled', () => {
  const logs = [];
  const config = routingConfig({ smartRoutingDebug: false });
  const logger = {
    debug: (...args) => logs.push(args),
    info: (...args) => logs.push(args),
    warn: (...args) => logs.push(args)
  };
  createRouter({ config, logger }).route(autoInput({ text: 'Hello' }));
  assert.deepEqual(logs, []);
});

test('malformed input never throws and preserves automatic default fallback', () => {
  const router = new AIModelRouter({
    config: {
      smartRoutingEnabled: true,
      smartRoutingModels: {},
      smartRoutingProviders: {},
      providerModels: {},
      defaultAIProvider: 'auto',
      defaultModel: ''
    },
    providerManager: {
      listProviders: () => []
    },
    logger: { warn() {}, debug() {}, info() {} }
  });
  let route;
  assert.doesNotThrow(() => {
    route = router.route(null);
  });
  assert.equal(route.taskType, 'general_chat');
  assert.equal(route.provider, 'auto');
  assert.equal(route.model, '');
  assert.equal(route.source, 'default');
});
