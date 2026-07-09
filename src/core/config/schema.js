import { AppError } from '../errors/app-error.js';
import { ErrorCodes } from '../errors/error-codes.js';

function ensure(condition, message, details) {
  if (!condition) {
    throw new AppError({
      code: ErrorCodes.CONFIG_INVALID,
      message,
      details,
      status: 500
    });
  }
}

export function validateConfig(raw) {
  ensure(raw && typeof raw === 'object', 'Configuration payload is required.');
  ensure(Boolean(raw.botToken), 'Missing BOT_TOKEN in environment.', { key: 'BOT_TOKEN' });
  ensure(Boolean(raw.aiProvider), 'AI provider is required.', { key: 'AI_PROVIDER' });
  ensure(Boolean(raw.defaultModel), 'AI model is required.', { key: 'AI_MODEL' });
  ensure(raw.maxHistoryMessages > 0, 'MAX_HISTORY_MESSAGES must be greater than zero.');
  ensure(raw.maxContextChars > 0, 'MAX_CONTEXT_CHARS must be greater than zero.');
  ensure(raw.maxInputChars > 0, 'MAX_INPUT_CHARS must be greater than zero.');
  ensure(raw.maxOutputChars > 0, 'MAX_OUTPUT_CHARS must be greater than zero.');
  ensure(raw.requestTimeoutMs > 0, 'REQUEST_TIMEOUT_MS must be greater than zero.');
  ensure(raw.healthPort > 0, 'HEALTH_PORT must be greater than zero.');
  ensure(Boolean(raw.databaseFile), 'DATABASE_FILE must resolve to a valid path.');

  return raw;
}
