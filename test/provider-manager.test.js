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

test('AIProviderManager skips remaining models for provider-wide quota failures', async () => {
  const calls = [];
  const manager = new AIProviderManager({
    config: baseConfig({
      aiProviderMaxRetries: 3,
      providerModels: {
        gemini: ['gemini-model', 'gemini-second-model'],
        groq: ['groq-model'],
        openrouter: ['openrouter-model'],
        huggingface: ['hf-model']
      }
    }),
    logger,
    clientFactory: fakeFactory({
      gemini: [
        new Error('AI request failed (429): project quota exhausted'),
        { text: 'must not retry Gemini', messages: [] },
        { text: 'must not try another Gemini model', messages: [] }
      ],
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
  assert.deepEqual(calls.map((item) => `${item.providerId}/${item.model}`), [
    'gemini/gemini-model',
    'groq/groq-model'
  ]);
});

test('AIProviderManager still switches Gemini models for model-scoped quota failures', async () => {
  const calls = [];
  const manager = new AIProviderManager({
    config: baseConfig({
      providerModels: {
        gemini: ['gemini-model', 'gemini-second-model'],
        groq: ['groq-model'],
        openrouter: ['openrouter-model'],
        huggingface: ['hf-model']
      }
    }),
    logger,
    clientFactory: fakeFactory({
      gemini: [
        new Error([
          'AI request failed (429): You exceeded your current quota, please check your plan and billing details.',
          'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count,',
          'limit: 0, model: gemini-model'
        ].join(' ')),
        { text: 'gemini fallback ok', messages: [{ role: 'assistant', content: 'gemini fallback ok' }] }
      ]
    }, calls)
  });

  const result = await manager.execute({
    capability: 'chat',
    preferredProvider: 'gemini',
    preferredModel: 'gemini-model',
    fallbackEnabled: true,
    request: { messages: [{ role: 'user', content: 'hello' }], tools: [] }
  });

  assert.equal(result.providerId, 'gemini');
  assert.equal(result.model, 'gemini-second-model');
  assert.deepEqual(calls.map((item) => `${item.providerId}/${item.model}`), [
    'gemini/gemini-model',
    'gemini/gemini-second-model'
  ]);
  assert.equal(manager.getCooldown('gemini', 'chat'), null, 'a model-scoped quota error must not cool every Gemini model');
});

test('AIProviderManager tries a backup model after a per-attempt inline timeout', async () => {
  const calls = [];
  const manager = new AIProviderManager({
    config: baseConfig({
      providerModels: {
        gemini: ['gemini-model', 'gemini-second-model'],
        groq: ['groq-model'],
        openrouter: ['openrouter-model'],
        huggingface: ['hf-model']
      }
    }),
    logger,
    clientFactory: (providerConfig) => ({
      getProviderName: () => providerConfig.aiProvider,
      getCapabilities: () => ({ chat: true, toolCalls: false }),
      async completeWithTools(request) {
        calls.push(`${providerConfig.aiProvider}/${request.model}`);
        if (request.model === 'gemini-model') {
          await new Promise((resolve) => setTimeout(resolve, Number(request.requestTimeoutMs) || 1));
          throw new Error('AI provider request timeout.');
        }
        return { text: 'backup model ok', messages: [{ role: 'assistant', content: 'backup model ok' }] };
      }
    })
  });

  const result = await manager.execute({
    capability: 'chat',
    preferredProvider: 'gemini',
    preferredModel: 'gemini-model',
    fallbackEnabled: true,
    request: {
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      requestTimeoutMs: 20,
      suppressTimeoutCooldown: true
    }
  });

  assert.equal(result.model, 'gemini-second-model');
  assert.deepEqual(calls, ['gemini/gemini-model', 'gemini/gemini-second-model']);
});

test('AIProviderManager treats a disabled billing account as provider-wide', async () => {
  const calls = [];
  const manager = new AIProviderManager({
    config: baseConfig({
      providerModels: {
        gemini: ['gemini-model', 'gemini-second-model'],
        groq: ['groq-model'],
        openrouter: ['openrouter-model'],
        huggingface: ['hf-model']
      }
    }),
    logger,
    clientFactory: fakeFactory({
      gemini: [
        new Error('AI request failed (429): billing account is disabled'),
        { text: 'must not try another Gemini model', messages: [] }
      ],
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
  assert.deepEqual(calls.map((item) => `${item.providerId}/${item.model}`), [
    'gemini/gemini-model',
    'groq/groq-model'
  ]);
});

test('AIProviderManager does not cool down providers after external cancellation', async () => {
  const calls = [];
  const cancelled = new Error('This operation was aborted');
  cancelled.name = 'AbortError';
  const manager = new AIProviderManager({
    config: baseConfig(),
    logger,
    clientFactory: fakeFactory({
      gemini: [cancelled],
      groq: [{ text: 'must not run', messages: [] }]
    }, calls)
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    manager.execute({
      capability: 'chat',
      preferredProvider: 'gemini',
      preferredModel: 'gemini-model',
      fallbackEnabled: true,
      request: {
        signal: controller.signal,
        messages: [{ role: 'user', content: 'hello' }],
        tools: []
      }
    }),
    (error) => error?.name === 'AbortError'
  );

  assert.deepEqual(calls.map((item) => item.providerId), ['gemini']);
  assert.equal(manager.getCooldown('gemini', 'chat'), null);
  assert.equal(manager.getCooldown('groq', 'chat'), null);
});

test('AIProviderManager falls back without cooldown after an inline deadline timeout', async () => {
  const timedOut = new Error('This operation was aborted');
  timedOut.name = 'AbortError';
  const manager = new AIProviderManager({
    config: baseConfig(),
    logger,
    clientFactory: fakeFactory({
      gemini: [timedOut],
      groq: [{ text: 'groq ok', messages: [{ role: 'assistant', content: 'groq ok' }] }]
    })
  });
  const controller = new AbortController();

  const result = await manager.execute({
    capability: 'chat',
    preferredProvider: 'gemini',
    preferredModel: 'gemini-model',
    fallbackEnabled: true,
    request: {
      signal: controller.signal,
      requestTimeoutMs: 50,
      suppressTimeoutCooldown: true,
      messages: [{ role: 'user', content: 'hello' }],
      tools: []
    }
  });

  assert.equal(result.providerId, 'groq');
  assert.equal(controller.signal.aborted, false);
  assert.equal(manager.getCooldown('gemini', 'chat'), null);
});

for (const [failureType, failure] of [
  ['authentication', new Error('AI request failed (401): invalid API key')],
  ['permission', new Error('AI request failed (403): forbidden')]
]) {
  test(`AIProviderManager skips remaining provider models after ${failureType} failure`, async () => {
    const calls = [];
    const manager = new AIProviderManager({
      config: baseConfig({
        providerModels: {
          gemini: ['gemini-model', 'gemini-second-model'],
          groq: ['groq-model'],
          openrouter: ['openrouter-model'],
          huggingface: ['hf-model']
        }
      }),
      logger,
      clientFactory: fakeFactory({
        gemini: [
          failure,
          { text: 'must not try another Gemini model', messages: [] }
        ],
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
    assert.deepEqual(calls.map((item) => `${item.providerId}/${item.model}`), [
      'gemini/gemini-model',
      'groq/groq-model'
    ]);
  });
}

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
