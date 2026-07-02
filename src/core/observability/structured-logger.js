import { getRequestContext } from './request-context.js';

const levels = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
};

function normalizeMeta(meta) {
  if (!meta) return undefined;
  if (meta instanceof Error) {
    return {
      name: meta.name,
      message: meta.message,
      stack: meta.stack
    };
  }
  return meta;
}

function write(level, message, meta) {
  const context = getRequestContext();
  const payload = {
    timestamp: new Date().toISOString(),
    level: levels[level] ?? 'INFO',
    requestId: context.requestId,
    message,
    ...(normalizeMeta(meta) ? { meta: normalizeMeta(meta) } : {})
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
