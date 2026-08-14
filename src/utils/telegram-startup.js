function telegramErrorCode(error) {
  return Number(error?.response?.error_code || error?.error_code || error?.status || 0);
}

function telegramRetryAfterMs(error) {
  const seconds = Number(
    error?.response?.parameters?.retry_after ??
    error?.parameters?.retry_after ??
    0
  );
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

export function isRetryableTelegramStartupError(error) {
  const status = telegramErrorCode(error);
  if (status === 429 || status >= 500) return true;
  if ([400, 401, 403, 404].includes(status)) return false;
  const code = String(error?.code || error?.errno || '').toUpperCase();
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) {
    return true;
  }
  const detail = String(error?.message || error || '').toLowerCase();
  return /timeout|timed out|network|fetch failed|socket hang up|connection reset/.test(detail);
}

export async function retryTelegramStartupCall(operation, {
  maxRetries = 6,
  baseDelayMs = 1000,
  maxDelayMs = 30000,
  logger,
  label = 'telegram_startup',
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const retries = Math.max(0, Math.min(20, Number(maxRetries) || 0));
  const base = Math.max(100, Number(baseDelayMs) || 1000);
  const maximum = Math.max(base, Number(maxDelayMs) || 30000);

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isRetryableTelegramStartupError(error)) throw error;
      const serverDelay = telegramRetryAfterMs(error);
      const exponential = Math.min(maximum, base * (2 ** attempt));
      const jitter = Math.floor(exponential * 0.15 * Math.random());
      const delayMs = Math.min(maximum, Math.max(serverDelay, exponential + jitter));
      logger?.warn?.('Telegram startup request failed; retrying', {
        operation: label,
        attempt: attempt + 1,
        retryInMs: delayMs,
        errorCode: telegramErrorCode(error) || String(error?.code || ''),
        error: String(error?.message || error).slice(0, 300)
      });
      await sleep(delayMs);
    }
  }
}
