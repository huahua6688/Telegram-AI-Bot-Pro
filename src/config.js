import 'dotenv/config';
import path from 'node:path';

const personaPresets = {
  default: 'You are a capable, context-aware Telegram AI assistant. Understand the user intent before answering, use tools when facts must be current or verified, ask one concise clarifying question when essential information is missing, and give practical answers without pretending to know what you cannot verify.',
  coder: 'You are a senior software engineer assistant. Prefer clear technical reasoning, debugging help, and production-safe advice.',
  translator: 'You are a translation assistant. Preserve meaning, tone, and formatting, and explain ambiguities briefly when useful.',
  teacher: 'You are a patient teacher. Explain step by step, but stay concise and adapt to the user\'s likely level.',
  writer: 'You are a writing assistant. Improve clarity, structure, tone, and creativity while preserving intent.'
};

function normalizeProvider(value = '', fallback = 'openai-compatible') {
  const provider = String(value).trim().toLowerCase();
  if (!provider) return fallback;
  if (provider === 'auto') return 'auto';
  if (provider === 'openai-compatible' || provider === 'compatible' || provider === 'custom') return 'openai-compatible';
  if (provider === 'openai' || provider === 'openai-official') return 'openai';
  if (provider === 'anthropic' || provider === 'claude') return 'anthropic';
  if (provider === 'google' || provider === 'gemini') return 'gemini';
  if (provider === 'gemini-live' || provider === 'gemini_live' || provider === 'google-live') return 'gemini-live';
  if (provider === 'groq') return 'groq';
  if (provider === 'openrouter' || provider === 'open-router') return 'openrouter';
  if (provider === 'github' || provider === 'github-models' || provider === 'github_models') return 'github-models';
  if (provider === 'huggingface' || provider === 'hugging-face' || provider === 'hf') return 'huggingface';
  if (provider === 'mistral' || provider === 'mistral-ai') return 'mistral';
  if (provider === 'qwen' || provider === 'tongyi' || provider === 'dashscope') return 'qwen';
  if (provider === 'grok' || provider === 'xai') return 'grok';
  if (provider === 'deepseek') return 'deepseek';
  if (provider === 'glm' || provider === 'zhipu' || provider === 'chatglm') return 'glm';
  if (provider === 'doubao' || provider === 'ark' || provider === 'volcengine') return 'doubao';
  return fallback;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseInteger(value, defaultValue) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseList(value) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProviderList(value, fallback = []) {
  const items = parseList(value).map((item) => normalizeProvider(item, '')).filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : fallback;
}

function compactList(...values) {
  return Array.from(
    new Set(
      values
        .flat()
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );
}

export function loadConfig() {
  const aiProvider = normalizeProvider(
    process.env.DEFAULT_AI_PROVIDER || process.env.AI_PROVIDER || 'openai-compatible'
  );
  const configuredFallbackModels = parseList(process.env.AI_FALLBACK_MODELS);
  const providerDefaultModels = {
    'openai-compatible': 'gpt-4.1-mini',
    openai: 'gpt-4.1-mini',
    anthropic: 'claude-3-5-sonnet-latest',
    gemini: 'gemini-2.5-flash',
    'gemini-live': 'gemini-2.5-flash-preview-native-audio-dialog',
    groq: '',
    openrouter: '',
    'github-models': '',
    huggingface: '',
    mistral: '',
    qwen: 'qwen-plus',
    grok: 'grok-3-mini-beta',
    deepseek: 'deepseek-chat',
    glm: 'glm-4-flash',
    doubao: 'doubao-seed-1-6-250615'
  };
  const providerFallbackModels = {
    gemini: ['gemini-2.5-flash-lite']
  };
  const legacyModelFor = (providerId) => (aiProvider === providerId ? process.env.AI_MODEL : '');
  const providerModels = {
    'openai-compatible': compactList(process.env.AI_MODEL, configuredFallbackModels),
    openai: compactList(process.env.OPENAI_MODEL, legacyModelFor('openai'), parseList(process.env.OPENAI_FALLBACK_MODELS)),
    anthropic: compactList(process.env.ANTHROPIC_MODEL, legacyModelFor('anthropic'), parseList(process.env.ANTHROPIC_FALLBACK_MODELS)),
    gemini: compactList(
      process.env.GEMINI_MODEL,
      legacyModelFor('gemini'),
      parseList(process.env.GEMINI_FALLBACK_MODELS || process.env.AI_FALLBACK_MODELS),
      providerDefaultModels.gemini,
      providerFallbackModels.gemini
    ),
    'gemini-live': compactList(
      process.env.GEMINI_LIVE_MODEL,
      legacyModelFor('gemini-live'),
      providerDefaultModels['gemini-live'],
      process.env.GEMINI_LIVE_TRANSCRIPTION_MODEL,
      process.env.GEMINI_LIVE_TTS_MODEL
    ),
    groq: compactList(process.env.GROQ_MODEL, legacyModelFor('groq'), parseList(process.env.GROQ_FALLBACK_MODELS)),
    openrouter: compactList(process.env.OPENROUTER_MODEL, legacyModelFor('openrouter'), parseList(process.env.OPENROUTER_FALLBACK_MODELS)),
    'github-models': compactList(process.env.GITHUB_MODELS_MODEL, legacyModelFor('github-models'), parseList(process.env.GITHUB_MODELS_FALLBACK_MODELS)),
    huggingface: compactList(process.env.HUGGINGFACE_MODEL, legacyModelFor('huggingface'), parseList(process.env.HUGGINGFACE_FALLBACK_MODELS)),
    mistral: compactList(process.env.MISTRAL_MODEL, legacyModelFor('mistral'), parseList(process.env.MISTRAL_FALLBACK_MODELS)),
    qwen: compactList(process.env.QWEN_MODEL, legacyModelFor('qwen'), parseList(process.env.QWEN_FALLBACK_MODELS)),
    grok: compactList(process.env.GROK_MODEL, legacyModelFor('grok'), parseList(process.env.GROK_FALLBACK_MODELS)),
    deepseek: compactList(process.env.DEEPSEEK_MODEL, legacyModelFor('deepseek'), parseList(process.env.DEEPSEEK_FALLBACK_MODELS)),
    glm: compactList(process.env.GLM_MODEL, legacyModelFor('glm'), parseList(process.env.GLM_FALLBACK_MODELS)),
    doubao: compactList(process.env.DOUBAO_MODEL, legacyModelFor('doubao'), parseList(process.env.DOUBAO_FALLBACK_MODELS))
  };
  for (const [providerId, models] of Object.entries(providerModels)) {
    if (models.length === 0 && providerDefaultModels[providerId]) {
      providerModels[providerId] = [providerDefaultModels[providerId]];
    }
  }
  const fallbackModels = configuredFallbackModels.length > 0
    ? configuredFallbackModels
    : providerFallbackModels[aiProvider] || [];
  const defaultModel =
    process.env.DEFAULT_AI_MODEL ||
    providerModels[aiProvider]?.[0] ||
    process.env.AI_MODEL ||
    providerDefaultModels[aiProvider] ||
    'gpt-4.1-mini';
  providerModels[aiProvider] = compactList(defaultModel, providerModels[aiProvider] || [], fallbackModels);
  const fallbackOrder = normalizeProviderList(
    process.env.AI_PROVIDER_FALLBACK_ORDER,
    compactList(aiProvider, 'gemini', 'groq', 'openrouter').map((item) => normalizeProvider(item, '')).filter(Boolean)
  ).filter((item) => item !== 'auto');
  const databaseFile = path.resolve(process.cwd(), process.env.DATABASE_FILE || './data/bot-data.db');
  const legacyDataFile = path.resolve(process.cwd(), process.env.DATA_FILE || './data/bot-data.json');

  return {
    botToken: process.env.BOT_TOKEN || '',
    aiProvider,
    defaultAIProvider: aiProvider,
    aiApiKey: process.env.AI_API_KEY || '',
    aiBaseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    openaiApiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '',
    openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY || '',
    anthropicBaseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
    anthropicApiVersion: process.env.ANTHROPIC_API_VERSION || '2023-06-01',
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '',
    geminiBaseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
    geminiLiveApiKey: process.env.GEMINI_LIVE_API_KEY || '',
    geminiLiveBaseUrl: (process.env.GEMINI_LIVE_BASE_URL || process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
    groqApiKey: process.env.GROQ_API_KEY || '',
    groqBaseUrl: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    openrouterBaseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    openrouterHttpReferer: process.env.OPENROUTER_HTTP_REFERER || '',
    openrouterAppTitle: process.env.OPENROUTER_APP_TITLE || 'Telegram AI Bot Pro',
    githubModelsApiKey: process.env.GITHUB_MODELS_API_KEY || process.env.GITHUB_TOKEN || '',
    githubModelsBaseUrl: (process.env.GITHUB_MODELS_BASE_URL || 'https://models.github.ai/inference').replace(/\/$/, ''),
    huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || '',
    huggingfaceBaseUrl: (process.env.HUGGINGFACE_BASE_URL || 'https://router.huggingface.co/v1').replace(/\/$/, ''),
    mistralApiKey: process.env.MISTRAL_API_KEY || '',
    mistralBaseUrl: (process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1').replace(/\/$/, ''),
    qwenApiKey: process.env.QWEN_API_KEY || process.env.AI_API_KEY || '',
    qwenBaseUrl: (process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, ''),
    qwenApiVersion: process.env.QWEN_API_VERSION || '',
    grokApiKey: process.env.GROK_API_KEY || process.env.AI_API_KEY || '',
    grokBaseUrl: (process.env.GROK_BASE_URL || 'https://api.x.ai/v1').replace(/\/$/, ''),
    grokApiVersion: process.env.GROK_API_VERSION || '',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || '',
    deepseekBaseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
    deepseekApiVersion: process.env.DEEPSEEK_API_VERSION || '',
    glmApiKey: process.env.GLM_API_KEY || process.env.AI_API_KEY || '',
    glmBaseUrl: (process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
    glmApiVersion: process.env.GLM_API_VERSION || '',
    doubaoApiKey: process.env.DOUBAO_API_KEY || process.env.AI_API_KEY || '',
    doubaoBaseUrl: (process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, ''),
    doubaoApiVersion: process.env.DOUBAO_API_VERSION || '',
    defaultModel,
    providerModels,
    providerDefaultModels,
    availableModels: compactList(defaultModel, providerModels[aiProvider] || [], fallbackModels),
    enableUserProviderSelection: parseBoolean(process.env.ENABLE_USER_PROVIDER_SELECTION, true),
    enableUserModelSelection: parseBoolean(process.env.ENABLE_USER_MODEL_SELECTION, true),
    enableProviderFallback: parseBoolean(process.env.ENABLE_PROVIDER_FALLBACK, true),
    aiProviderFallbackOrder: fallbackOrder,
    aiProviderMaxRetries: parseInteger(process.env.AI_PROVIDER_MAX_RETRIES, 1),
    aiProviderRetryDelayMs: parseInteger(process.env.AI_PROVIDER_RETRY_DELAY_MS, 800),
    aiProviderCooldownMs: parseInteger(process.env.AI_PROVIDER_COOLDOWN_MS, 60000),
    modelListCacheTtlMs: parseInteger(process.env.MODEL_LIST_CACHE_TTL_MS, 3600000),
    systemPrompt: process.env.AI_SYSTEM_PROMPT || personaPresets.default,
    temperature: Number.parseFloat(process.env.AI_TEMPERATURE || '0.6') || 0.6,
    transcriptionProvider: normalizeProvider(process.env.TRANSCRIPTION_PROVIDER || 'gemini-live', 'gemini-live'),
    transcriptionModel: process.env.TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    ttsProvider: normalizeProvider(process.env.TTS_PROVIDER || 'gemini-live', 'gemini-live'),
    ttsModel: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
    geminiLiveTranscriptionModel: process.env.GEMINI_LIVE_TRANSCRIPTION_MODEL || process.env.TRANSCRIPTION_MODEL || defaultModel,
    geminiLiveTtsModel: process.env.GEMINI_LIVE_TTS_MODEL || process.env.TTS_MODEL || defaultModel,
    ttsVoice: process.env.TTS_VOICE || 'alloy',
    translationProvider: normalizeProvider(process.env.TRANSLATION_PROVIDER || aiProvider, aiProvider),
    translationModel: process.env.TRANSLATION_MODEL || defaultModel,
    routerProvider: normalizeProvider(process.env.ROUTER_PROVIDER || aiProvider, aiProvider),
    routerModel: process.env.ROUTER_MODEL || process.env.TRANSLATION_MODEL || defaultModel,
    memoryProvider: normalizeProvider(process.env.MEMORY_PROVIDER || aiProvider, aiProvider),
    memoryModel: process.env.MEMORY_MODEL || process.env.ROUTER_MODEL || defaultModel,
    visionProvider: normalizeProvider(process.env.VISION_PROVIDER || 'gemini', 'gemini'),
    visionModel: process.env.VISION_MODEL || providerModels.gemini?.[0] || defaultModel,
    enableAiRouter: parseBoolean(process.env.ENABLE_AI_ROUTER, false),
    aiRouterMode: process.env.AI_ROUTER_MODE || 'single-pass',
    enableMemorySummary: parseBoolean(process.env.ENABLE_MEMORY_SUMMARY, true),
    memorySummaryInterval: Math.max(1, Number.parseInt(process.env.MEMORY_SUMMARY_INTERVAL || '5', 10) || 5),
    imageProvider: normalizeProvider(process.env.IMAGE_PROVIDER || 'openai-compatible', 'openai-compatible'),
    imageModel: process.env.IMAGE_MODEL || 'gpt-image-1',
    imageSize: process.env.IMAGE_SIZE || '1024x1024',
    documentMaxBytes: parseInteger(process.env.DOCUMENT_MAX_BYTES, 6 * 1024 * 1024),
    documentChunkChars: parseInteger(process.env.DOCUMENT_CHUNK_CHARS, 1800),
    documentMaxChars: parseInteger(process.env.DOCUMENT_MAX_CHARS, 12000),
    enableToolCalls: parseBoolean(process.env.ENABLE_TOOL_CALLS, true),
    enableWebSearch: parseBoolean(process.env.ENABLE_WEB_SEARCH, true),
    enableGeminiGoogleSearch: parseBoolean(process.env.ENABLE_GEMINI_GOOGLE_SEARCH, true),
    enableUrlFetch: parseBoolean(process.env.ENABLE_URL_FETCH, true),
    toolAllowedNames: new Set(parseList(process.env.TOOL_ALLOWED_NAMES || 'get_time,get_weather,fetch_url,web_search')),
    toolAllowedUserIds: new Set(parseList(process.env.TOOL_ALLOWED_USER_IDS).map(String)),
    toolAllowedChatIds: new Set(parseList(process.env.TOOL_ALLOWED_CHAT_IDS).map(String)),
    toolBlockedUserIds: new Set(parseList(process.env.TOOL_BLOCKED_USER_IDS).map(String)),
    toolAdminOnlyNames: new Set(parseList(process.env.TOOL_ADMIN_ONLY_NAMES).map(String)),
    toolMaxCallsPerMessage: parseInteger(process.env.TOOL_MAX_CALLS_PER_MESSAGE, 4),
    toolUserWindowMs: parseInteger(process.env.TOOL_USER_WINDOW_MS, 60000),
    toolUserMaxCalls: parseInteger(process.env.TOOL_USER_MAX_CALLS, 20),
    networkToolScope: (process.env.NETWORK_TOOL_SCOPE || 'all').toLowerCase(),
    networkToolAllowedUserIds: new Set(parseList(process.env.NETWORK_TOOL_ALLOWED_USER_IDS).map(String)),
    networkToolAllowedChatIds: new Set(parseList(process.env.NETWORK_TOOL_ALLOWED_CHAT_IDS).map(String)),
    enableLiveAudio: parseBoolean(process.env.ENABLE_LIVE_AUDIO, true),
    enableLiveTranslate: parseBoolean(process.env.ENABLE_LIVE_TRANSLATE, true),
    maxHistoryMessages: parseInteger(process.env.MAX_HISTORY_MESSAGES, 32),
    maxContextChars: parseInteger(process.env.MAX_CONTEXT_CHARS, 48000),
    maxInputChars: parseInteger(process.env.MAX_INPUT_CHARS, 12000),
    maxOutputChars: parseInteger(process.env.MAX_OUTPUT_CHARS, 3500),
    requestTimeoutMs: parseInteger(process.env.REQUEST_TIMEOUT_MS, 120000),
    rateLimitWindowMs: parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    rateLimitMaxRequests: parseInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 12),
    dailyQuota: parseInteger(process.env.DAILY_QUOTA, 200),
    healthPort: parseInteger(process.env.HEALTH_PORT || process.env.PORT, 3000),
    adminApiPort: parseInteger(process.env.ADMIN_API_PORT, 3001),
    adminApiPrefix: process.env.ADMIN_API_PREFIX || '/admin/api/v1',
    adminApiToken: process.env.ADMIN_API_TOKEN || '',
    adminApiEnabled: parseBoolean(process.env.ADMIN_API_ENABLED, false),
    miniAppEnabled: parseBoolean(process.env.MINI_APP_ENABLED, true),
    miniAppAuthMaxAgeSeconds: parseInteger(process.env.MINI_APP_AUTH_MAX_AGE_SECONDS, 3600),
    enableSecretaryAutoReply: parseBoolean(process.env.ENABLE_SECRETARY_AUTO_REPLY, true),
    guardDefaultAction: ['approve', 'decline', 'queue'].includes(String(process.env.GUARD_DEFAULT_ACTION || '').toLowerCase())
      ? String(process.env.GUARD_DEFAULT_ACTION).toLowerCase()
      : 'queue',
    botCollaborationCooldownMs: parseInteger(process.env.BOT_COLLABORATION_COOLDOWN_MS, 5000),
    inlineQueryDebounceMs: parseInteger(process.env.INLINE_QUERY_DEBOUNCE_MS, 1200),
    inlineQueryCacheTtlMs: parseInteger(process.env.INLINE_QUERY_CACHE_TTL_MS, 60000),
    databaseFile,
    legacyDataFile,
    adminUserIds: new Set(parseList(process.env.ADMIN_USER_IDS).map(String)),
    allowedUserIds: new Set(parseList(process.env.ALLOWED_USER_IDS).map(String)),
    allowedChatIds: new Set(parseList(process.env.ALLOWED_CHAT_IDS).map(String)),
    blockedUserIds: new Set(parseList(process.env.BLOCKED_USER_IDS).map(String)),
    groupTriggerMode: (process.env.GROUP_TRIGGER_MODE || 'smart').toLowerCase(),
    groupTriggerKeyword: process.env.GROUP_TRIGGER_KEYWORD || 'ai',
    aiMaxToolSteps: parseInteger(process.env.AI_MAX_TOOL_STEPS, 3),
    enableStreamingReplies: parseBoolean(process.env.ENABLE_STREAMING_REPLIES, true),
    streamingEditIntervalMs: parseInteger(process.env.STREAMING_EDIT_INTERVAL_MS, 350),
    streamingMinLength: parseInteger(process.env.STREAMING_MIN_LENGTH, 160),
    personaPresets
  };
}

export { normalizeProvider, personaPresets };
