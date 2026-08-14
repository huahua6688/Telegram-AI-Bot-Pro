import { getRequestContext } from './request-context.js';
import { createHmac, randomBytes } from 'node:crypto';

const levels = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
};

const logPrivacyKey = randomBytes(32);
const secretKeyPattern = /(?:api[_-]?key|token|secret|password|authorization|cookie|init[_-]?data|encryption[_-]?key)/i;
const safeIdentifierKeyPattern = /^(?:provider|model|request|task|tool|tool[_-]?call|capability|feature)[_-]?id$/i;
const identityKeyPattern = /ids?$/i;
const contentKeyPattern = /(?:prompt|caption|content|message[_-]?text|query[_-]?text|input[_-]?text|conversation|history|^message$|^text$|^detail$|^raw$|^body$|^payload$|^stack$)/i;
const personalKeyPattern = /(?:username|first[_-]?name|last[_-]?name|display[_-]?name|email|phone|^ip$|remote[_-]?address|user[_-]?agent)/i;

function anonymize(value) {
  return `anon:${createHmac('sha256', logPrivacyKey).update(String(value || '')).digest('hex').slice(0, 12)}`;
}

function scrubString(value, maximum = 2000) {
  return String(value || '')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_BOT_TOKEN]')
    .replace(/\b(?:sk|gsk|AIza)[-_A-Za-z0-9]{16,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .slice(0, maximum);
}

function sanitizeMetaValue(value, key = '', depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Error) {
    return {
      name: scrubString(value.name, 120),
      ...(value.code ? { code: scrubString(value.code, 120) } : {}),
      ...(value.statusCode ? { statusCode: Number(value.statusCode) || undefined } : {})
    };
  }
  if (secretKeyPattern.test(key) || contentKeyPattern.test(key) || personalKeyPattern.test(key)) {
    return '[REDACTED]';
  }
  if (key === 'error' && typeof value !== 'object') return '[REDACTED]';
  if (!safeIdentifierKeyPattern.test(key) && identityKeyPattern.test(key)) return anonymize(value);
  if (key === 'path' || key === 'url') return scrubString(value).split('?')[0];
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return scrubString(value);
  if (depth >= 6 || seen.has(value)) return '[TRUNCATED]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetaValue(item, key, depth + 1, seen));
  }

  const sanitized = {};
  for (const [nestedKey, nestedValue] of Object.entries(value).slice(0, 50)) {
    sanitized[nestedKey] = sanitizeMetaValue(nestedValue, nestedKey, depth + 1, seen);
  }
  return sanitized;
}

function normalizeMeta(meta) {
  if (!meta) return undefined;
  return sanitizeMetaValue(meta);
}

function write(level, message, meta) {
  const context = getRequestContext();
  const normalizedMeta = normalizeMeta(meta);
  const payload = {
    timestamp: new Date().toISOString(),
    level: levels[level] ?? 'INFO',
    requestId: scrubString(context.requestId, 200),
    message: scrubString(message),
    ...(normalizedMeta ? { meta: normalizedMeta } : {})
  };

  const output = JSON.stringify(payload);
  if (level === 'debug') {
    console.log(output);
    return;
  }

  console[level]?.(output);
}

export function createStructuredLogger() {
  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta)
  };
}
