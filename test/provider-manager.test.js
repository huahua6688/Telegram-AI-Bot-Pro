import test from 'node:test';
import assert from 'node:assert/strict';
import { AIProviderManager, classifyProviderError } from '../src/services/ai-provider-manager.js';

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

function baseConfig(overrides = {}) {
  return {
    aiProvider: 'gemini',
    defaultModel: 'gemini-model',
    providerModels: {
      gemini: ['gemini-model'],
      groq: ['groq-model'],
      openrouter: ['openrouter-model'],
      huggingface: ['hf-model']
    },
    providerDefaultModels: {},
    availableModels: ['gemini-model'],
    aiProviderFallbackOrder: ['gemini', 'groq', 'openrouter'],
    enableProviderFallback: true,
    aiProviderMaxRetries: 1,
    aiProviderRetryDelayMs: 0,
    aiProviderCooldownMs: 1000,
    geminiApiKey: 'gemini-key',
    groqApiKey: 'groq-key',
    openrouterApiKey: 'openrouter-key',
    huggingfaceApiKey: 'hf-key',
    requestTimeoutMs: 1000,
    temperature: 0,
    aiMaxToolSteps: 1,
    ...overrides
  };
}

function fakeFactory(script, calls = []) {
  return (providerConfig) => {
    const providerId = providerConfig.aiProvider;
    return {
      getProviderName: () => providerId,
      getCapabilities: () => ({
        chat: true,
        toolCalls: providerId !== 'huggingface',
        vision: providerId === 'gemini' || providerId === 'openrouter'
      }),
      async completeWithTools(request) {
        calls.push({ providerId, model: request.model, tools: request.tools || [] });
        const next = script[providerId]?.shift?.();
        if (next instanceof Error) throw next;
        return next || {
          text: `${providerId}_OK`,
          messages: [{ role: 'assistant', content: `${providerId}_OK` }]
        };
      }
    };
  };
}

test('AIProviderManager falls back from Gemini 429 to Groq', async () => {
  const calls = [];
  const manager = new AIProviderManager({
    config: baseConfig(),
    logger,
    clientFactory: fakeFactory({
      gemini: [new Error('AI request failed (429): quota')],
      groq: [{ text: 'groq ok', messages: [{ role: 'assistant', content: 'groq ok' }] }]
    }, calls)
  });

  const result = await manager.execute({
    capability: 'chat',
    preferredProvider: 'gemini',
    preferredModel: 'gemini-model',
    fallbackEnabled: true,
    request: { messages: [{ role: 'user', content: 'hello' }], tools: [] }
  });

  assert.equal(result.providerId, 'groq');
  assert.equal(result.model, 'groq-model');
  assert.equal(result.switched, true);
  assert.deepEqual(calls.map((item) => item.providerId), ['gemini', 'groq']);
});

test('AIProviderManager does not cross providers when fallback is disabled', async () => {
  const manager = new AIProviderManager({
    config: baseConfig(),
    logger,
    clientFactory: fakeFactory({
      gemini: [new Error('AI request failed (503): busy')],
      groq: [{ text: 'should not run', messages: [] }]
    })
  });

  await assert.rejects(
    () => manager.execute({
      capability: 'chat',
      preferredProvider: 'gemini',
      preferredModel: 'gemini-model',
      fallbackEnabled: false,
      request: { messages: [{ role: 'user', content: 'hello' }], tools: [] }
    }),
    /All configured AI providers failed/
  );
});

test('AIProviderManager still tries same-provider fallback models when cross-provider fallback is disabled', async () => {
  const calls = [];
  const manager = new AIProviderManager({
    config: baseConfig({
      providerModels: {
        gemini: ['gemini-bad-model', 'gemini-good-model'],
        groq: ['groq-model'],
        openrouter: ['openrouter-model'],
        huggingface: ['hf-model']
      }
    }),
    logger,
    clientFactory: fakeFactory({
      gemini: [
        new Error('AI request failed (404): model not found'),
        { text: 'gemini ok', messages: [{ role: 'assistant', content: 'gemini ok' }] }
      ],
      groq: [{ text: 'should not run', messages: [] }]
    }, calls)
  });

  const result = await manager.execute({
    capability: 'chat',
    preferredProvider: 'gemini',
    preferredModel: 'gemini-bad-model',
    fallbackEnabled: false,
    request: { messages: [{ role: 'user', content: 'hello' }], tools: [] }
  });

  assert.equal(result.providerId, 'gemini');
  assert.equal(result.model, 'gemini-good-model');
  assert.deepEqual(calls.map((item) => `${item.providerId}/${item.model}`), [
    'gemini/gemini-bad-model',
    'gemini/gemini-good-model'
  ]);
});

test('AIProviderManager reports setup problems separately from provider failures', async () => {
  const manager = new AIProviderManager({
    config: baseConfig({
      geminiApiKey: '',
      groqApiKey: '',
      openrouterApiKey: '',
      huggingfaceApiKey: ''
    }),
    logger,
    clientFactory: fakeFactory({})
  });

  await assert.rejects(
    () => manager.execute({
      capability: 'chat',
      preferredProvider: 'gemini',
      preferredModel: 'gemini-model',
      fallbackEnabled: true,
      request: { messages: [{ role: 'user', content: 'hello' }], tools: [] }
    }),
    (error) => {
      assert.equal(error.code, 'NO_USABLE_AI_PROVIDER');
      assert.match(error.message, /No usable AI provider is configured/);
      return true;
    }
  );
});

test('AIProviderManager skips unconfigured providers', async () => {
  const manager = new AIProviderManager({
    config: baseConfig({ geminiApiKey: '' }),
    logger,
    clientFactory: fakeFactory({
      groq: [{ text: 'groq ok', messages: [{ role: 'assistant', content: 'groq ok' }] }]
    })
  });

  const result = await manager.execute({
    capability: 'chat',
    preferredProvider: 'gemini',
    preferredModel: 'gemini-model',
    fallbackEnabled: true,
    request: { messages: [{ role: 'user', content: 'hello' }], tools: [] }
  });

  assert.equal(result.providerId, 'groq');
});

test('AIProviderManager strips tools for providers without tool calling', async () => {
  const calls = [];
  const manager = new AIProviderManager({
    config: baseConfig({
      aiProviderFallbackOrder: ['huggingface'],
      aiProvider: 'huggingface',
      defaultModel: 'hf-model'
    }),
    logger,
    clientFactory: fakeFactory({
      huggingface: [{ text: 'hf ok', messages: [{ role: 'assistant', content: 'hf ok' }] }]
    }, calls)
  });

  const result = await manager.execute({
    capability: 'chat',
    preferredProvider: 'huggingface',
    preferredModel: 'hf-model',
    fallbackEnabled: true,
    request: {
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ type: 'function', function: { name: 'web_search' } }]
    }
  });

  assert.equal(result.providerId, 'huggingface');
  assert.deepEqual(calls[0].tools, []);
});

test('AIProviderManager can ignore cooldown for admin provider tests', async () => {
  const calls = [];
  const manager = new AIProviderManager({
    config: baseConfig(),
    logger,
    clientFactory: fakeFactory({
      gemini: [{ text: 'gemini ok', messages: [{ role: 'assistant', content: 'gemini ok' }] }]
    }, calls)
  });
  manager.setCooldown('gemini', 'chat', new Error('AI request failed (503): busy'), 60000);

  const result = await manager.execute({
    capability: 'chat',
    preferredProvider: 'gemini',
    preferredModel: 'gemini-model',
    fallbackEnabled: false,
    ignoreCooldown: true,
    request: { messages: [{ role: 'user', content: 'hello' }], tools: [] }
  });

  assert.equal(result.providerId, 'gemini');
  assert.equal(calls.length, 1);
});

test('provider error classifier detects OpenRouter model and credit failures', () => {
  assert.equal(
    classifyProviderError(new Error('AI request failed (400): No endpoints found matching your request')),
    'model'
  );
  assert.equal(
    classifyProviderError(new Error('AI request failed (402): insufficient credits')),
    'quota'
  );
});
