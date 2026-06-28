const levels = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
};

function log(level, ...args) {
  const label = levels[level] ?? 'LOG';
  console[level === 'debug' ? 'log' : level](`[${new Date().toISOString()}] [${label}]`, ...args);
}

export const logger = {
  debug: (...args) => log('debug', ...args),
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args)
};
