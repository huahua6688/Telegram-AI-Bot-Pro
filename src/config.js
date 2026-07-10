import 'dotenv/config';
import path from 'node:path';

const personaPresets = {
  default: 'You are a capable, context-aware Telegram AI assistant. Understand the user intent before answering, use tools when facts must be current or verified, ask one concise clarifying question when essential information is missing, and give practical answers without pretending to know what you cannot verify.',
  coder: 'You are a senior software engineer assistant. Prefer clear technical reasoning, debugging help, and production-safe advice.',
  translator: 'You are a translation assistant. Preserve meaning, tone, and formatting, and explain ambiguities briefly when useful.',
  teacher: 'You are a patient teacher. Explain step by step, but stay concise and adapt to the user\'s likely level.',
  writer: 'You are a writing assistant. Improve clarity, structure, tone, and creativity while preserving intent.'
};

function normalizeProvider(value = '') {
  const provider = String(value).trim().toLowerCase();
  if (provider === 'openai' || provider === 'openai-compatible') return 'openai-compatible';
  if (provider === 'anthropic' || provider === 'claude') return 'anthropic';
  if (provider === 'google' || provider === 'gemini') return 'gemini';
  if (provider === 'gemini-live' || provider === 'gemini_live' || provider === 'google-live') return 'gemini-live';
  if (provider === 'qwen' || provider === 'tongyi' || provider === 'dashscope') return 'qwen';
  if (provider === 'grok' || provider === 'xai') return 'grok';
  if (provider === 'deepseek') return 'deepseek';
  if (provider === 'glm' || provider === 'zhipu' || provider === 'chatglm') return 'glm';
  if (provider === 'doubao' || provider === 'ark' || provider === 'volcengine') return 'doubao';
  return 'openai-compatible';
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

export function loadConfig() {
  const aiProvider = normalizeProvider(process.env.AI_PROVIDER || 'openai-compatible');
  const configuredFallbackModels = parseList(process.env.AI_FALLBACK_MODELS);
  const providerDefaultModels = {
    'openai-compatible': 'gpt-4.1-mini',
    anthropic: 'claude-3-5-sonnet-latest',
    gemini: 'gemini-3.5-flash',
    'gemini-live': 'gemini-2.5-flash-preview-native-audio-dialog',
    qwen: 'qwen-plus',
    grok: 'grok-3-mini-beta',
    deepseek: 'deepseek-chat',
    glm: 'glm-4-flash',
    doubao: 'doubao-seed-1-6-250615'
  };
  const providerFallbackModels = {
    gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
  };
  const defaultModel = process.env.AI_MODEL || providerDefaultModels[aiProvider];
  const fallbackModels = configuredFallbackModels.length > 0
    ? configuredFallbackModels
    : providerFallbackModels[aiProvider] || [];
  const databaseFile = path.resolve(process.cwd(), process.env.DATABASE_FILE || './data/bot-data.db');
  const legacyDataFile = path.resolve(process.cwd(), process.env.DATA_FILE || './data/bot-data.json');

  return {
    botToken: process.env.BOT_TOKEN || '',
    aiProvider,
    aiApiKey: process.env.AI_API_KEY || '',
    aiBaseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY || '',
    anthropicBaseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
    anthropicApiVersion: process.env.ANTHROPIC_API_VERSION || '2023-06-01',
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '',
    geminiBaseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
    geminiLiveApiKey: process.env.GEMINI_LIVE_API_KEY || process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '',
    geminiLiveBaseUrl: (process.env.GEMINI_LIVE_BASE_URL || process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
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
    availableModels: Array.from(new Set([defaultModel, ...fallbackModels].filter(Boolean))),
    systemPrompt: process.env.AI_SYSTEM_PROMPT || personaPresets.default,
    temperature: Number.parseFloat(process.env.AI_TEMPERATURE || '0.6') || 0.6,
    transcriptionModel: process.env.TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    ttsModel: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
    geminiLiveTranscriptionModel: process.env.GEMINI_LIVE_TRANSCRIPTION_MODEL || process.env.TRANSCRIPTION_MODEL || defaultModel,
    geminiLiveTtsModel: process.env.GEMINI_LIVE_TTS_MODEL || process.env.TTS_MODEL || defaultModel,
    ttsVoice: process.env.TTS_VOICE || 'alloy',
    translationModel: process.env.TRANSLATION_MODEL || defaultModel,
    routerModel: process.env.ROUTER_MODEL || process.env.TRANSLATION_MODEL || defaultModel,
    enableAiRouter: parseBoolean(process.env.ENABLE_AI_ROUTER, false),
    aiRouterMode: process.env.AI_ROUTER_MODE || 'single-pass',
    enableMemorySummary: parseBoolean(process.env.ENABLE_MEMORY_SUMMARY, true),
    memorySummaryInterval: Math.max(1, Number.parseInt(process.env.MEMORY_SUMMARY_INTERVAL || '5', 10) || 5),
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

export { personaPresets };
