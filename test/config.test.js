import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const ORIGINAL_ENV = { ...process.env };
const SMART_ROUTING_ENV_SUFFIXES = [
  'GENERAL',
  'TRANSLATION',
  'CODE',
  'REASONING',
  'LONG_CONTEXT',
  'DOCUMENT',
  'VISION',
  'OCR',
  'TOOL',
  'CHEAP'
];

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function clearSmartRoutingEnv() {
  delete process.env.SMART_ROUTING_ENABLED;
  delete process.env.SMART_ROUTING_DEBUG;
  delete process.env.SMART_ROUTING_MIN_CONFIDENCE;
  for (const suffix of SMART_ROUTING_ENV_SUFFIXES) {
    delete process.env[`ROUTER_${suffix}_MODEL`];
    delete process.env[`ROUTER_${suffix}_PROVIDER`];
  }
}

test('loadConfig defaults to automatic free-first provider routing', () => {
  resetEnv();
  delete process.env.DEFAULT_AI_PROVIDER;
  delete process.env.AI_PROVIDER;
  const config = loadConfig();
  assert.equal(config.aiProvider, 'auto');
});

test('loadConfig resolves anthropic provider aliases and keys', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'claude';
  process.env.AI_API_KEY = 'shared-key';
  const config = loadConfig();
  assert.equal(config.aiProvider, 'anthropic');
  assert.equal(config.anthropicApiKey, 'shared-key');
});

test('loadConfig resolves gemini provider aliases and keys', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'google';
  process.env.GEMINI_API_KEY = 'gemini-key';
  const config = loadConfig();
  assert.equal(config.aiProvider, 'gemini');
  assert.equal(config.geminiApiKey, 'gemini-key');
});

test('Gemini has working fallback models even when env does not configure them', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_MODEL = 'gemini-2.5-flash';
  delete process.env.AI_FALLBACK_MODELS;

  const config = loadConfig();
  assert.equal(config.defaultModel, 'gemini-2.5-flash');
  assert.ok(config.availableModels.includes('gemini-2.5-flash-lite'));
  assert.ok(config.availableModels.length >= 2);
});

test('loadConfig resolves gemini-live aliases and keys', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'google-live';
  process.env.GEMINI_API_KEY = 'gemini-shared-key';
  process.env.GEMINI_LIVE_API_KEY = 'gemini-live-key';
  const config = loadConfig();
  assert.equal(config.aiProvider, 'gemini-live');
  assert.equal(config.geminiLiveApiKey, 'gemini-live-key');
  assert.equal(config.geminiApiKey, 'gemini-shared-key');
});

test('loadConfig keeps Gemini Live separate from ordinary Gemini keys', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'gemini-live';
  process.env.GEMINI_API_KEY = 'gemini-key';
  delete process.env.GEMINI_LIVE_API_KEY;

  const config = loadConfig();
  assert.equal(config.aiProvider, 'gemini-live');
  assert.equal(config.geminiApiKey, 'gemini-key');
  assert.equal(config.geminiLiveApiKey, '');
});

test('loadConfig keeps Live features disabled unless explicitly enabled', () => {
  resetEnv();
  delete process.env.ENABLE_LIVE_AUDIO;
  delete process.env.ENABLE_LIVE_TRANSLATE;

  let config = loadConfig();
  assert.equal(config.enableLiveAudio, false);
  assert.equal(config.enableLiveTranslate, false);

  process.env.ENABLE_LIVE_AUDIO = 'true';
  process.env.ENABLE_LIVE_TRANSLATE = 'true';
  config = loadConfig();
  assert.equal(config.enableLiveAudio, true);
  assert.equal(config.enableLiveTranslate, true);
});

test('loadConfig uses the stable cross-provider fallback order by default', () => {
  resetEnv();
  process.env.DEFAULT_AI_PROVIDER = 'auto';
  delete process.env.AI_PROVIDER_FALLBACK_ORDER;

  const config = loadConfig();
  assert.deepEqual(config.aiProviderFallbackOrder, ['gemini', 'groq', 'openrouter', 'openai-compatible']);
});

test('loadConfig resolves first-batch native provider aliases', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'xai';
  let config = loadConfig();
  assert.equal(config.aiProvider, 'grok');

  process.env.AI_PROVIDER = 'tongyi';
  config = loadConfig();
  assert.equal(config.aiProvider, 'qwen');

  process.env.AI_PROVIDER = 'chatglm';
  config = loadConfig();
  assert.equal(config.aiProvider, 'glm');

  process.env.AI_PROVIDER = 'ark';
  config = loadConfig();
  assert.equal(config.aiProvider, 'doubao');
});

test('loadConfig resolves multi-provider defaults and fallback order', () => {
  resetEnv();
  process.env.DEFAULT_AI_PROVIDER = 'groq';
  process.env.GROQ_MODEL = 'llama-current';
  process.env.GROQ_FALLBACK_MODELS = 'qwen-current';
  process.env.OPENROUTER_MODEL = 'openrouter/free-model:free';
  process.env.AI_PROVIDER_FALLBACK_ORDER = 'groq,openrouter,gemini';

  const config = loadConfig();
  assert.equal(config.aiProvider, 'groq');
  assert.equal(config.defaultModel, 'llama-current');
  assert.deepEqual(config.providerModels.groq, ['llama-current', 'qwen-current']);
  assert.equal(config.providerModels.openrouter[0], 'openrouter/free-model:free');
  assert.deepEqual(config.aiProviderFallbackOrder, ['groq', 'openrouter', 'gemini']);
  assert.equal(config.enableUserProviderSelection, true);
  assert.equal(config.enableProviderFallback, true);
});

test('loadConfig resolves second-batch provider aliases and keys', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'github';
  process.env.GITHUB_TOKEN = 'gh-token';
  let config = loadConfig();
  assert.equal(config.aiProvider, 'github-models');
  assert.equal(config.githubModelsApiKey, 'gh-token');

  process.env.AI_PROVIDER = 'hf';
  process.env.HF_TOKEN = 'hf-token';
  config = loadConfig();
  assert.equal(config.aiProvider, 'huggingface');
  assert.equal(config.huggingfaceApiKey, 'hf-token');

  process.env.AI_PROVIDER = 'mistral-ai';
  process.env.MISTRAL_API_KEY = 'mistral-key';
  config = loadConfig();
  assert.equal(config.aiProvider, 'mistral');
  assert.equal(config.mistralApiKey, 'mistral-key');
});

test('loadConfig supports provider-specific key fallback to AI_API_KEY', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_API_KEY = 'shared-key';
  const config = loadConfig();
  assert.equal(config.aiProvider, 'deepseek');
  assert.equal(config.deepseekApiKey, 'shared-key');
});

test('legacy AI_API_KEY does not make unrelated fallback providers look configured', () => {
  resetEnv();
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_API_KEY = 'gemini-legacy-key';
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.QWEN_API_KEY;
  delete process.env.GROK_API_KEY;
  delete process.env.GLM_API_KEY;
  delete process.env.DOUBAO_API_KEY;

  const config = loadConfig();
  assert.equal(config.geminiApiKey, 'gemini-legacy-key');
  assert.equal(config.openaiApiKey, '');
  assert.equal(config.anthropicApiKey, '');
  assert.equal(config.deepseekApiKey, '');
  assert.equal(config.qwenApiKey, '');
  assert.equal(config.grokApiKey, '');
  assert.equal(config.glmApiKey, '');
  assert.equal(config.doubaoApiKey, '');
});

test('loadConfig exposes safe Smart AI Router defaults', () => {
  resetEnv();
  clearSmartRoutingEnv();

  const config = loadConfig();
  const emptyRoutes = {
    general: '',
    translation: '',
    code: '',
    reasoning: '',
    long_context: '',
    document: '',
    vision: '',
    ocr: '',
    tool: '',
    cheap: ''
  };

  assert.equal(config.smartRoutingEnabled, true);
  assert.equal(config.smartRoutingDebug, false);
  assert.equal(config.smartRoutingMinConfidence, 0.55);
  assert.deepEqual(config.smartRoutingModels, emptyRoutes);
  assert.deepEqual(config.smartRoutingProviders, emptyRoutes);
});

test('loadConfig normalizes Smart AI Router providers and clamps confidence', () => {
  resetEnv();
  clearSmartRoutingEnv();
  process.env.DEFAULT_AI_PROVIDER = 'auto';
  process.env.SMART_ROUTING_ENABLED = 'false';
  process.env.SMART_ROUTING_DEBUG = 'yes';
  process.env.SMART_ROUTING_MIN_CONFIDENCE = '1.75';
  process.env.ROUTER_CODE_PROVIDER = 'claude';
  process.env.ROUTER_CODE_MODEL = 'code-special';
  process.env.ROUTER_LONG_CONTEXT_PROVIDER = 'google';
  process.env.ROUTER_LONG_CONTEXT_MODEL = 'context-special';
  process.env.ROUTER_OCR_PROVIDER = 'github';
  process.env.ROUTER_OCR_MODEL = 'ocr-special';

  let config = loadConfig();
  assert.equal(config.smartRoutingEnabled, false);
  assert.equal(config.smartRoutingDebug, true);
  assert.equal(config.smartRoutingMinConfidence, 1);
  assert.equal(config.smartRoutingProviders.code, 'anthropic');
  assert.equal(config.smartRoutingProviders.long_context, 'gemini');
  assert.equal(config.smartRoutingProviders.ocr, 'github-models');
  assert.ok(config.providerModels.anthropic.includes('code-special'));
  assert.ok(config.providerModels.gemini.includes('context-special'));
  assert.ok(config.providerModels['github-models'].includes('ocr-special'));

  process.env.SMART_ROUTING_MIN_CONFIDENCE = '-0.2';
  config = loadConfig();
  assert.equal(config.smartRoutingMinConfidence, 0);

  process.env.SMART_ROUTING_MIN_CONFIDENCE = 'not-a-number';
  config = loadConfig();
  assert.equal(config.smartRoutingMinConfidence, 0.55);
});

test('fixed providers associate blank-provider Smart route models with the shared provider', () => {
  resetEnv();
  clearSmartRoutingEnv();
  process.env.DEFAULT_AI_PROVIDER = 'custom';
  process.env.DEFAULT_AI_MODEL = 'hub-default';
  process.env.ROUTER_GENERAL_MODEL = 'hub-general';
  process.env.ROUTER_REASONING_MODEL = 'hub-reasoning';
  process.env.ROUTER_TOOL_PROVIDER = 'unknown-provider';
  process.env.ROUTER_TOOL_MODEL = 'must-not-be-associated';

  const config = loadConfig();
  assert.equal(config.aiProvider, 'openai-compatible');
  assert.equal(config.smartRoutingProviders.general, '');
  assert.equal(config.smartRoutingProviders.reasoning, '');
  assert.equal(config.smartRoutingProviders.tool, '');
  assert.ok(config.providerModels['openai-compatible'].includes('hub-general'));
  assert.ok(config.providerModels['openai-compatible'].includes('hub-reasoning'));
  assert.equal(config.providerModels['openai-compatible'].includes('must-not-be-associated'), false);
});

test('auto provider requires an explicit provider before associating a Smart route model', () => {
  resetEnv();
  clearSmartRoutingEnv();
  process.env.DEFAULT_AI_PROVIDER = 'auto';
  process.env.DEFAULT_AI_MODEL = 'auto-default';
  process.env.ROUTER_CHEAP_MODEL = 'unpaired-cheap-model';

  const config = loadConfig();
  assert.equal(config.smartRoutingProviders.cheap, '');
  assert.equal(
    Object.values(config.providerModels).some((models) => models.includes('unpaired-cheap-model')),
    false
  );
});

test('Smart AI Router settings do not change the legacy intent router fields', () => {
  resetEnv();
  clearSmartRoutingEnv();
  process.env.DEFAULT_AI_PROVIDER = 'gemini';
  process.env.ENABLE_AI_ROUTER = 'true';
  process.env.ROUTER_PROVIDER = 'google';
  process.env.ROUTER_MODEL = 'legacy-intent-router';
  process.env.ROUTER_GENERAL_PROVIDER = 'claude';
  process.env.ROUTER_GENERAL_MODEL = 'smart-general';

  const config = loadConfig();
  assert.equal(config.enableAiRouter, true);
  assert.equal(config.routerProvider, 'gemini');
  assert.equal(config.routerModel, 'legacy-intent-router');
  assert.equal(config.smartRoutingProviders.general, 'anthropic');
  assert.equal(config.smartRoutingModels.general, 'smart-general');
});

test('loadConfig parses Telegram Stars products and independent free quotas', () => {
  resetEnv();
  process.env.STARS_PRODUCTS_JSON = JSON.stringify([{
    id: 'starter',
    title: '入门额度包',
    titleEn: 'Starter credits',
    description: '综合额度',
    descriptionEn: 'Mixed credits',
    price: 42,
    credits: { chat: 100, vision: 9, image: 3, tts: 8, live_audio: 4, video: 2 }
  }]);
  process.env.STARS_FREE_CHAT_DAILY = '12';
  process.env.STARS_FREE_VISION_DAILY = '2';
  process.env.STARS_FREE_VIDEO_DAILY = '0';
  process.env.STARS_USAGE_RESERVATION_TTL_MINUTES = '9';
  delete process.env.ENABLE_VIDEO;

  const config = loadConfig();
  assert.equal(config.starsProducts[0].price, 42);
  assert.deepEqual(config.starsProducts[0].credits, {
    chat: 100,
    vision: 9,
    image_generation: 3,
    tts: 8,
    live_voice: 4,
    video: 2
  });
  assert.equal(config.starsFreeQuota.chat, 12);
  assert.equal(config.starsFreeQuota.vision, 2);
  assert.equal(config.starsFreeQuota.video, 0);
  assert.equal(config.starsUsageReservationTtlMinutes, 9);
  assert.equal(config.enableVideo, false);
});

test('loadConfig rejects invalid Telegram Stars prices instead of hardcoding a fallback', () => {
  resetEnv();
  process.env.STARS_PRODUCTS_JSON = JSON.stringify([{
    id: 'bad',
    title: 'Bad pack',
    description: 'Bad price',
    price: 0,
    credits: { chat: 1 }
  }]);

  assert.throws(() => loadConfig(), /price must be a positive integer/i);
});

test('loadConfig defaults to SQLite storage and streaming replies', () => {
  resetEnv();
  delete process.env.DATABASE_FILE;
  delete process.env.DATA_FILE;
  delete process.env.ENABLE_STREAMING_REPLIES;
  delete process.env.ENABLE_RICH_MESSAGES;
  const config = loadConfig();
  assert.match(config.databaseFile, /bot-data\.db$/);
  assert.match(config.legacyDataFile, /bot-data\.json$/);
  assert.equal(config.enableStreamingReplies, true);
  assert.equal(config.enableRichMessages, true);
});

test('loadConfig parses tool policy and document parsing options', () => {
  resetEnv();
  process.env.TOOL_ALLOWED_NAMES = 'get_time,web_search';
  process.env.NETWORK_TOOL_SCOPE = 'admin';
  process.env.DOCUMENT_MAX_BYTES = '2048';
  const config = loadConfig();
  assert.equal(config.toolAllowedNames.has('get_time'), true);
  assert.equal(config.toolAllowedNames.has('web_search'), true);
  assert.equal(config.networkToolScope, 'admin');
  assert.equal(config.documentMaxBytes, 2048);
});

test('loadConfig exposes safe Telegram platform mode defaults', () => {
  resetEnv();
  delete process.env.ENABLE_SECRETARY_AUTO_REPLY;
  delete process.env.GUARD_DEFAULT_ACTION;
  delete process.env.BOT_COLLABORATION_COOLDOWN_MS;
  delete process.env.INLINE_QUERY_DEBOUNCE_MS;
  delete process.env.INLINE_QUERY_MIN_CHARS;
  delete process.env.INLINE_QUERY_RESPONSE_TIMEOUT_MS;
  delete process.env.INLINE_QUERY_SEARCH_TIMEOUT_MS;
  delete process.env.INLINE_QUERY_AI_ATTEMPT_TIMEOUT_MS;
  delete process.env.INLINE_QUERY_CACHE_TTL_MS;
  delete process.env.NEWS_REGION;
  delete process.env.NEWS_LANGUAGE;
  delete process.env.NEWS_TIME_ZONE;
  let config = loadConfig();
  assert.equal(config.enableSecretaryAutoReply, true);
  assert.equal(config.guardDefaultAction, 'queue');
  assert.equal(config.botCollaborationCooldownMs, 5000);
  assert.equal(config.inlineQueryDebounceMs, 1200);
  assert.equal(config.inlineQueryMinChars, 2);
  assert.equal(config.inlineQueryResponseTimeoutMs, 8000);
  assert.equal(config.inlineQuerySearchTimeoutMs, 2300);
  assert.equal(config.inlineQueryAiAttemptTimeoutMs, 2200);
  assert.equal(config.inlineQueryCacheTtlMs, 60000);
  assert.equal(config.newsRegion, 'MY');
  assert.equal(config.newsLanguage, 'auto');
  assert.equal(config.newsTimeZone, 'Asia/Kuala_Lumpur');

  process.env.ENABLE_SECRETARY_AUTO_REPLY = 'false';
  process.env.GUARD_DEFAULT_ACTION = 'decline';
  process.env.BOT_COLLABORATION_COOLDOWN_MS = '9000';
  process.env.INLINE_QUERY_DEBOUNCE_MS = '900';
  process.env.INLINE_QUERY_MIN_CHARS = '3';
  process.env.INLINE_QUERY_RESPONSE_TIMEOUT_MS = '6500';
  process.env.INLINE_QUERY_SEARCH_TIMEOUT_MS = '1800';
  process.env.INLINE_QUERY_AI_ATTEMPT_TIMEOUT_MS = '900';
  process.env.INLINE_QUERY_CACHE_TTL_MS = '120000';
  process.env.NEWS_REGION = 'sg';
  process.env.NEWS_LANGUAGE = 'en-SG';
  process.env.NEWS_TIME_ZONE = 'Asia/Singapore';
  config = loadConfig();
  assert.equal(config.enableSecretaryAutoReply, false);
  assert.equal(config.guardDefaultAction, 'decline');
  assert.equal(config.botCollaborationCooldownMs, 9000);
  assert.equal(config.inlineQueryDebounceMs, 900);
  assert.equal(config.inlineQueryMinChars, 3);
  assert.equal(config.inlineQueryResponseTimeoutMs, 6500);
  assert.equal(config.inlineQuerySearchTimeoutMs, 1800);
  assert.equal(config.inlineQueryAiAttemptTimeoutMs, 900);
  assert.equal(config.inlineQueryCacheTtlMs, 120000);
  assert.equal(config.newsRegion, 'SG');
  assert.equal(config.newsLanguage, 'en-SG');
  assert.equal(config.newsTimeZone, 'Asia/Singapore');

  process.env.NEWS_REGION = 'not-a-region';
  process.env.NEWS_LANGUAGE = '<invalid>';
  process.env.NEWS_TIME_ZONE = 'Mars/Olympus';
  config = loadConfig();
  assert.equal(config.newsRegion, 'MY');
  assert.equal(config.newsLanguage, 'auto');
  assert.equal(config.newsTimeZone, 'Asia/Kuala_Lumpur');
});

test('loadConfig parses admin API options', () => {
  resetEnv();
  process.env.ADMIN_API_ENABLED = 'true';
  process.env.ADMIN_API_PORT = '3900';
  process.env.ADMIN_API_PREFIX = '/admin/api/v2';
  process.env.ADMIN_API_TOKEN = 'token-123';
  const config = loadConfig();
  assert.equal(config.adminApiEnabled, true);
  assert.equal(config.adminApiPort, 3900);
  assert.equal(config.adminApiPrefix, '/admin/api/v2');
  assert.equal(config.adminApiToken, 'token-123');
});

test('loadConfig exposes the current free-credit and support defaults', () => {
  resetEnv();
  for (const key of [
    'DAILY_QUOTA',
    'STARS_PRODUCTS_JSON',
    'STARS_FREE_CHAT_DAILY',
    'STARS_FREE_VISION_DAILY',
    'STARS_FREE_IMAGE_DAILY',
    'STARS_FREE_TTS_DAILY',
    'STARS_FREE_LIVE_VOICE_DAILY',
    'STARS_FREE_VIDEO_DAILY',
    'SUPPORT_ENABLED',
    'SUPPORT_BOT_TOKEN',
    'SUPPORT_BOT_USERNAME',
    'SUPPORT_CONTACT_URL',
    'SUPPORT_ADMIN_IDS',
    'SUPPORT_RATE_LIMIT_WINDOW_MS',
    'SUPPORT_RATE_LIMIT_MAX_MESSAGES',
    'ENABLE_STARTUP_DIAGNOSTICS',
    'SHOW_VERSION_INFO',
    'HEALTH_CHECK_ENABLED',
    'TELEGRAM_STARTUP_MAX_RETRIES',
    'TELEGRAM_STARTUP_RETRY_BASE_MS',
    'TELEGRAM_STARTUP_RETRY_MAX_MS',
    'TELEGRAM_FILE_MAX_BYTES',
    'TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS',
    'CONVERSATION_RETENTION_DAYS',
    'PRIVACY_SWEEP_INTERVAL_HOURS',
    'MINI_APP_SHOW_USER_MESSAGES'
  ]) delete process.env[key];

  const config = loadConfig();
  assert.equal(config.dailyQuota, 20);
  assert.deepEqual(config.starsFreeQuota, {
    chat: 20,
    vision: 3,
    image_generation: 1,
    tts: 2,
    live_voice: 2,
    video: 0
  });
  assert.deepEqual(config.starsProducts, []);
  assert.equal(config.starsFreeChatZeroMeansUnlimited, false);
  assert.equal(config.supportEnabled, true);
  assert.equal(config.supportBotToken, '');
  assert.equal(config.supportBotUsername, '');
  assert.equal(config.supportContactUrl, '');
  assert.deepEqual(config.supportAdminIds, new Set());
  assert.equal(config.supportRateLimitWindowMs, 60_000);
  assert.equal(config.supportRateLimitMaxMessages, 6);
  assert.equal(config.enableStartupDiagnostics, true);
  assert.equal(config.showVersionInfo, true);
  assert.equal(config.healthCheckEnabled, true);
  assert.equal(config.telegramStartupMaxRetries, 6);
  assert.equal(config.telegramStartupRetryBaseMs, 1000);
  assert.equal(config.telegramStartupRetryMaxMs, 30000);
  assert.equal(config.telegramFileMaxBytes, 10 * 1024 * 1024);
  assert.equal(config.telegramFileDownloadTimeoutMs, 20000);
  assert.equal(config.conversationRetentionDays, 30);
  assert.equal(config.privacySweepIntervalHours, 24);
  assert.equal(config.miniAppShowUserMessages, false);
});

test('loadConfig keeps explicit Stars zero finite and parses bounded support settings', () => {
  resetEnv();
  process.env.DAILY_QUOTA = '0';
  delete process.env.STARS_FREE_CHAT_DAILY;
  let config = loadConfig();
  assert.equal(config.starsFreeQuota.chat, 0);
  assert.equal(config.starsFreeChatZeroMeansUnlimited, true);

  process.env.STARS_FREE_CHAT_DAILY = '0';
  process.env.SUPPORT_ENABLED = 'false';
  process.env.SUPPORT_BOT_TOKEN = 'support-token';
  process.env.SUPPORT_BOT_USERNAME = '@ExampleSupportBot';
  process.env.SUPPORT_CONTACT_URL = 'https://support.example/help';
  process.env.SUPPORT_ADMIN_IDS = '10001, 10002';
  process.env.SUPPORT_RATE_LIMIT_WINDOW_MS = '500';
  process.env.SUPPORT_RATE_LIMIT_MAX_MESSAGES = '0';
  config = loadConfig();

  assert.equal(config.starsFreeQuota.chat, 0);
  assert.equal(config.starsFreeChatZeroMeansUnlimited, false);
  assert.equal(config.supportEnabled, false);
  assert.equal(config.supportBotToken, 'support-token');
  assert.equal(config.supportBotUsername, '@ExampleSupportBot');
  assert.equal(config.supportContactUrl, 'https://support.example/help');
  assert.deepEqual(config.supportAdminIds, new Set(['10001', '10002']));
  assert.equal(config.supportRateLimitWindowMs, 1_000);
  assert.equal(config.supportRateLimitMaxMessages, 1);
});
