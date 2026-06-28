import 'dotenv/config';
import path from 'node:path';

const personaPresets = {
  default: 'You are a powerful all-purpose Telegram AI assistant. Be accurate, practical, concise, and proactive when useful.',
  coder: 'You are a senior software engineer assistant. Prefer clear technical reasoning, debugging help, and production-safe advice.',
  translator: 'You are a translation assistant. Preserve meaning, tone, and formatting, and explain ambiguities briefly when useful.',
  teacher: 'You are a patient teacher. Explain step by step, but stay concise and adapt to the user\'s likely level.',
  writer: 'You are a writing assistant. Improve clarity, structure, tone, and creativity while preserving intent.'
};

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
  const fallbackModels = parseList(process.env.AI_FALLBACK_MODELS);
  const defaultModel = process.env.AI_MODEL || fallbackModels[0] || 'gpt-4.1-mini';
  const dataFile = path.resolve(process.cwd(), process.env.DATA_FILE || './data/bot-data.json');

  return {
    botToken: process.env.BOT_TOKEN || '',
    aiApiKey: process.env.AI_API_KEY || '',
    aiBaseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    defaultModel,
    availableModels: Array.from(new Set([defaultModel, ...fallbackModels].filter(Boolean))),
    systemPrompt: process.env.AI_SYSTEM_PROMPT || personaPresets.default,
    temperature: Number.parseFloat(process.env.AI_TEMPERATURE || '0.6') || 0.6,
    transcriptionModel: process.env.TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    ttsModel: process.env.TTS_MODEL || 'gpt-4o-mini-tts',
    ttsVoice: process.env.TTS_VOICE || 'alloy',
    imageModel: process.env.IMAGE_MODEL || 'gpt-image-1',
    imageSize: process.env.IMAGE_SIZE || '1024x1024',
    enableToolCalls: parseBoolean(process.env.ENABLE_TOOL_CALLS, true),
    enableWebSearch: parseBoolean(process.env.ENABLE_WEB_SEARCH, true),
    enableUrlFetch: parseBoolean(process.env.ENABLE_URL_FETCH, true),
    maxHistoryMessages: parseInteger(process.env.MAX_HISTORY_MESSAGES, 16),
    maxInputChars: parseInteger(process.env.MAX_INPUT_CHARS, 12000),
    maxOutputChars: parseInteger(process.env.MAX_OUTPUT_CHARS, 3500),
    requestTimeoutMs: parseInteger(process.env.REQUEST_TIMEOUT_MS, 120000),
    rateLimitWindowMs: parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000),
    rateLimitMaxRequests: parseInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 12),
    dailyQuota: parseInteger(process.env.DAILY_QUOTA, 200),
    healthPort: parseInteger(process.env.HEALTH_PORT, 3000),
    dataFile,
    adminUserIds: new Set(parseList(process.env.ADMIN_USER_IDS).map(String)),
    allowedUserIds: new Set(parseList(process.env.ALLOWED_USER_IDS).map(String)),
    allowedChatIds: new Set(parseList(process.env.ALLOWED_CHAT_IDS).map(String)),
    blockedUserIds: new Set(parseList(process.env.BLOCKED_USER_IDS).map(String)),
    groupTriggerMode: (process.env.GROUP_TRIGGER_MODE || 'smart').toLowerCase(),
    groupTriggerKeyword: process.env.GROUP_TRIGGER_KEYWORD || 'ai',
    aiMaxToolSteps: parseInteger(process.env.AI_MAX_TOOL_STEPS, 3),
    personaPresets
  };
}

export { personaPresets };
