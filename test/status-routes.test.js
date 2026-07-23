import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCapabilityDetails,
  buildHealthPayload
} from '../src/services/status-routes.js';

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
    }
  });

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
});
