import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import {
  buildCapabilityDetails,
  buildHealthPayload,
  installEnhancedStatusRoutes
} from '../src/services/status-routes.js';
import { startHealthServer } from '../src/services/health-server.js';

async function getServerUrl(server) {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createProviderManager(rows = []) {
  const providers = rows.map((row) => ({
    enabled: true,
    configured: false,
    available: true,
    capabilities: {},
    ...row
  }));

  function selectProvider({ capability, preferredProvider = '', fallbackEnabled = true } = {}) {
    const preferred = String(preferredProvider || '').toLowerCase();
    const candidates = providers.filter((row) =>
      row.enabled !== false &&
      row.configured &&
      row.available !== false &&
      row.capabilities?.[capability]
    );
    const direct = candidates.find((row) => row.id === preferred);
    const selected = direct || (fallbackEnabled ? candidates[0] : null);
    return selected ? { providerId: selected.id } : null;
  }

  return {
    listProviders: () => providers,
    selectProvider,
    hasAvailableProvider: (capability, preferredProvider) =>
      Boolean(selectProvider({ capability, preferredProvider, fallbackEnabled: true }))
  };
}

function baseConfig(overrides = {}) {
  return {
    aiProvider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    providerModels: {
      gemini: ['gemini-2.5-flash']
    },
    providerDefaultModels: {
      gemini: 'gemini-2.5-flash'
    },
    visionProvider: 'gemini',
    imageProvider: 'openai',
    transcriptionProvider: 'gemini-live',
    ttsProvider: 'gemini-live',
    enableToolCalls: true,
    enableWebSearch: true,
    enableGeminiGoogleSearch: true,
    toolAllowedNames: new Set(['web_search']),
    braveSearchApiKey: '',
    enableLiveAudio: true,
    enableLiveTranslate: true,
    enableVideo: true,
    ...overrides
  };
}

test('capability status uses configured provider keys and declared capabilities', () => {
  const providerManager = createProviderManager([
    {
      id: 'gemini',
      configured: true,
      capabilities: { chat: true, vision: true }
    },
    {
      id: 'openai',
      configured: false,
      capabilities: {
        imageGeneration: true,
        imageEditing: true,
        speechTranscription: true,
        speechSynthesis: true
      }
    },
    {
      id: 'gemini-live',
      configured: true,
      capabilities: {
        speechTranscription: true,
        speechSynthesis: true,
        liveAudio: true
      }
    }
  ]);

  const details = buildCapabilityDetails({
    config: baseConfig(),
    providerManager
  });

  assert.deepEqual(
    {
      status: details.webSearch.status,
      available: details.webSearch.available,
      provider: details.webSearch.provider
    },
    {
      status: 'ready',
      available: true,
      provider: 'gemini-google-search'
    }
  );
  assert.equal(details.vision.status, 'ready');
  assert.equal(details.imageGeneration.status, 'unconfigured');
  assert.equal(details.imageGeneration.available, false);
  assert.equal(details.imageGeneration.reason, 'provider_key_missing');
  assert.equal(details.speechTranscription.status, 'ready');
  assert.equal(details.speechSynthesis.status, 'ready');

  // Provider metadata alone must not claim unfinished Telegram pipelines work.
  assert.equal(details.liveAudio.status, 'unsupported');
  assert.equal(details.liveAudio.available, false);
  assert.equal(details.liveTranslate.status, 'unsupported');
  assert.equal(details.video.status, 'unsupported');
  assert.equal(details.video.available, false);
});

test('web search reports Brave as ready and keyless DuckDuckGo as degraded', () => {
  const providerManager = createProviderManager([]);

  const brave = buildCapabilityDetails({
    config: baseConfig({
      braveSearchApiKey: 'configured',
      enableGeminiGoogleSearch: false
    }),
    providerManager
  });
  assert.equal(brave.webSearch.status, 'ready');
  assert.equal(brave.webSearch.provider, 'brave');

  const keyless = buildCapabilityDetails({
    config: baseConfig({
      enableGeminiGoogleSearch: false
    }),
    providerManager
  });
  assert.equal(keyless.webSearch.status, 'degraded');
  assert.equal(keyless.webSearch.available, true);
  assert.equal(keyless.webSearch.provider, 'duckduckgo');

  const blockedByConfiguration = buildCapabilityDetails({
    config: baseConfig({
      toolAllowedNames: new Set(['get_time'])
    }),
    providerManager
  });
  assert.equal(blockedByConfiguration.webSearch.status, 'unconfigured');
  assert.equal(blockedByConfiguration.webSearch.available, false);

  const disabled = buildCapabilityDetails({
    config: baseConfig({
      enableWebSearch: false
    }),
    providerManager
  });
  assert.equal(disabled.webSearch.status, 'unsupported');
  assert.equal(disabled.webSearch.enabled, false);
});

test('provider fallback is shown as degraded instead of fully ready', () => {
  const providerManager = createProviderManager([
    {
      id: 'gemini',
      configured: true,
      capabilities: { chat: true, vision: true }
    },
    {
      id: 'openai',
      configured: true,
      capabilities: { imageGeneration: true, imageEditing: true }
    }
  ]);

  const details = buildCapabilityDetails({
    config: baseConfig({
      enableGeminiGoogleSearch: false,
      imageProvider: 'gemini'
    }),
    providerManager
  });

  assert.equal(details.imageGeneration.status, 'degraded');
  assert.equal(details.imageGeneration.available, true);
  assert.equal(details.imageGeneration.provider, 'openai');
  assert.equal(details.imageGeneration.reason, 'fallback_provider');
});

test('health payload keeps legacy boolean capabilities and adds status details', () => {
  const providerManager = createProviderManager([
    {
      id: 'gemini',
      configured: true,
      capabilities: { chat: true, vision: true }
    },
    {
      id: 'openai',
      configured: false,
      capabilities: { imageGeneration: true, imageEditing: true }
    }
  ]);
  const config = baseConfig({
    botToken: '1234-sensitive-telegram-token-5678',
    geminiApiKey: 'gemi-sensitive-provider-key-9876',
    adminApiToken: 'admin-sensitive-token',
    enableGeminiGoogleSearch: false,
    enableProviderFallback: true,
    enableUrlFetch: true,
    enableMemorySummary: true,
    availableModels: ['gemini-2.5-flash'],
    translationModel: 'gemini-2.5-flash',
    routerModel: 'gemini-2.5-flash',
    enableAiRouter: false,
    memorySummaryInterval: 5
  });
  const payload = buildHealthPayload({
    config,
    providerManager,
    bot: null,
    db: {
      chatEncryption: { enabled: true, version: '1' },
      getStats: () => ({ messagesHandled: 3 })
    },
    now: () => '2026-08-02T02:03:04.000Z',
    buildInfo: {
      version: '2.3.4',
      revision: 'abcdef0123456789abcdef0123456789abcdef01',
      shortRevision: 'abcdef012345',
      nodeVersion: 'v22.5.0',
      environment: 'production',
      deployedAt: '2026-08-01T00:00:00.000Z',
      startedAt: '2026-08-02T00:00:00.000Z'
    }
  });

  assert.equal(payload.status, 'ok');
  assert.equal(payload.timestamp, '2026-08-02T02:03:04.000Z');
  assert.equal(payload.version, '2.3.4');
  assert.equal(payload.node, 'v22.5.0');
  assert.equal(payload.environment, 'production');
  assert.equal(payload.deployedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(payload.startedAt, '2026-08-02T00:00:00.000Z');
  assert.equal(typeof payload.capabilities.webSearch, 'boolean');
  assert.equal(payload.capabilities.webSearch, true);
  assert.equal(payload.capabilityStatuses.webSearch, 'degraded');
  assert.equal(payload.capabilityDetails.webSearch.reason, 'keyless_search_fallback');
  assert.equal(payload.capabilities.imageGeneration, false);
  assert.equal(payload.capabilityStatuses.imageGeneration, 'unconfigured');
  assert.equal(payload.capabilities.video, false);
  assert.equal(payload.capabilityStatuses.video, 'unsupported');
  assert.ok(payload.enabledCapabilities.includes('webSearch'));
  assert.ok(!payload.enabledCapabilities.includes('video'));
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /1234-sensitive-telegram-token-5678/);
  assert.doesNotMatch(serialized, /gemi-sensitive-provider-key-9876/);
  assert.doesNotMatch(serialized, /admin-sensitive-token/);
});

test('base health route exposes safe build metadata and rejects non-GET methods', async () => {
  const config = baseConfig({
    healthCheckEnabled: true,
    botToken: '1234-sensitive-telegram-token-5678',
    geminiApiKey: 'gemi-sensitive-provider-key-9876'
  });
  const server = startHealthServer({
    port: 0,
    config,
    db: { getStats: () => ({ messagesHandled: 7 }) },
    logger: { info() {}, error() {} }
  });

  try {
    const url = await getServerUrl(server);
    const response = await fetch(`${url}/health`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, 'ok');
    assert.equal(payload.service, 'telegram-ai-bot-pro');
    assert.equal(typeof payload.timestamp, 'string');
    assert.equal(typeof payload.version, 'string');
    assert.equal(payload.node, process.version);
    assert.equal(typeof payload.startedAt, 'string');
    assert.doesNotMatch(JSON.stringify(payload), /sensitive/);

    const healthPost = await fetch(`${url}/health`, { method: 'POST' });
    assert.equal(healthPost.status, 405);
    assert.equal(healthPost.headers.get('allow'), 'GET');

    const readyPost = await fetch(`${url}/ready`, { method: 'POST' });
    assert.equal(readyPost.status, 405);
    assert.equal(readyPost.headers.get('allow'), 'GET');
  } finally {
    await closeServer(server);
  }
});

test('readiness stays false during initialization and becomes ready after launch', async () => {
  const readiness = { ready: false, phase: 'initializing' };
  const server = startHealthServer({
    port: 0,
    config: baseConfig({ healthCheckEnabled: true }),
    db: { getStats: () => ({ messagesHandled: 0 }) },
    logger: { info() {}, error() {} },
    readiness
  });
  try {
    const url = await getServerUrl(server);
    const pending = await fetch(`${url}/ready`);
    assert.equal(pending.status, 503);
    assert.deepEqual(await pending.json(), {
      ok: false,
      ready: false,
      phase: 'initializing',
      error: 'NOT_READY'
    });
    readiness.ready = true;
    readiness.phase = 'ready';
    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ready, true);
  } finally {
    await closeServer(server);
  }
});

test('disabled enhanced health route stays disabled without taking down readiness or Mini App', async () => {
  const config = baseConfig({ healthCheckEnabled: false });
  const db = {
    chatEncryption: { enabled: false },
    getStats: () => ({ messagesHandled: 0 })
  };
  const logger = { info() {}, error() {} };
  const server = startHealthServer({ port: 0, config, db, logger });
  installEnhancedStatusRoutes({
    server,
    config,
    db,
    logger,
    bot: null,
    providerManager: createProviderManager([])
  });

  try {
    const url = await getServerUrl(server);
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`${url}/health`, { method });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, 'HEALTH_CHECK_DISABLED');
    }

    const ready = await fetch(`${url}/ready`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ready, true);

    const miniApp = await fetch(`${url}/app`);
    assert.equal(miniApp.status, 200);
    assert.match(await miniApp.text(), /<!doctype html>/i);
  } finally {
    await closeServer(server);
  }
});
