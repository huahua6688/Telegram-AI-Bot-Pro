import { getRequestContext } from './request-context.js';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const levels = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
};

const secretKeyPattern = /(?:api[_-]?key|token|secret|password|authorization|cookie|init[_-]?data|encryption[_-]?key)/i;
const safeIdentifierKeyPattern = /^(?:provider|model|request|task|tool|tool[_-]?call|capability|feature)[_-]?id$/i;
const identityKeyPattern = /ids?$/i;
const contentKeyPattern = /(?:prompt|caption|content|message[_-]?text|query[_-]?text|input[_-]?text|conversation|history|^message$|^text$|^detail$|^raw$|^body$|^payload$|^stack$)/i;
const personalKeyPattern = /(?:username|first[_-]?name|last[_-]?name|display[_-]?name|email|phone|^ip$|remote[_-]?address|user[_-]?agent)/i;

function resolvePrivacyKey(value = '') {
  const configured = String(value || '');
  return configured.length >= 32
    ? createHash('sha256').update(configured).digest()
    : randomBytes(32);
}

function anonymize(value, privacyKey) {
  return `anon:${createHmac('sha256', privacyKey).update(String(value || '')).digest('hex').slice(0, 12)}`;
}

function scrubString(value, maximum = 2000) {
  return String(value || '')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_BOT_TOKEN]')
    .replace(/\b(?:sk|gsk|AIza|ghp|gho|ghu|ghs|ghr|github_pat|xox[baprs])[-_A-Za-z0-9]{12,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED_AWS_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, (match) => `${match.split(/\s/, 1)[0]} [REDACTED]`)
    .replace(/([?&](?:access_token|api_key|apikey|key|token|secret|password|signature)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/\b(password|passcode|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|encryption[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, maximum);
}

function sanitizeMetaValue(value, key = '', depth = 0, seen = new WeakSet(), privacyKey) {
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
  if (!safeIdentifierKeyPattern.test(key) && identityKeyPattern.test(key)) return anonymize(value, privacyKey);
  if (key === 'path' || key === 'url') return scrubString(value).split('?')[0];
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return scrubString(value);
  if (depth >= 6 || seen.has(value)) return '[TRUNCATED]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetaValue(item, key, depth + 1, seen, privacyKey));
  }

  const sanitized = {};
  for (const [nestedKey, nestedValue] of Object.entries(value).slice(0, 50)) {
    sanitized[nestedKey] = sanitizeMetaValue(nestedValue, nestedKey, depth + 1, seen, privacyKey);
  }
  return sanitized;
}

function normalizeMeta(meta, privacyKey) {
  if (!meta) return undefined;
  return sanitizeMetaValue(meta, '', 0, new WeakSet(), privacyKey);
}

function write(level, message, meta, privacyKey) {
  const context = getRequestContext();
  const normalizedMeta = normalizeMeta(meta, privacyKey);
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

export function createStructuredLogger({ privacyKey = process.env.LOG_PRIVACY_KEY || '' } = {}) {
  const resolvedPrivacyKey = resolvePrivacyKey(privacyKey);
  return {
    debug: (message, meta) => write('debug', message, meta, resolvedPrivacyKey),
    info: (message, meta) => write('info', message, meta, resolvedPrivacyKey),
    warn: (message, meta) => write('warn', message, meta, resolvedPrivacyKey),
    error: (message, meta) => write('error', message, meta, resolvedPrivacyKey)
  };
}
