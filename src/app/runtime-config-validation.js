function normalizeConfiguredIds(value) {
  const source = value instanceof Set
    ? Array.from(value)
    : Array.isArray(value)
      ? value
      : String(value || '').split(',');
  return source.map((item) => String(item || '').trim()).filter(Boolean);
}

const OBVIOUS_SECRET_PATTERN = /(?:replace[-_ ]?me|change[-_ ]?me|your[-_ ]|example|placeholder|test[-_ ]?token|secret123|password)/i;

export function isStrongRuntimeSecret(value, minimumLength = 32) {
  const secret = String(value || '');
  if (secret.length < minimumLength || /\s/.test(secret) || OBVIOUS_SECRET_PATTERN.test(secret)) return false;
  return new Set(secret).size >= 10;
}

export function getRuntimeConfigErrors(config = {}) {
  const errors = [];

  const botToken = String(config.botToken || '').trim();
  if (!botToken || botToken === 'your_telegram_bot_token') {
    errors.push('BOT_TOKEN is missing or still uses the placeholder value.');
  }

  if (!String(config.defaultModel || '').trim()) {
    errors.push('AI_MODEL is missing.');
  }

  if (config.adminApiEnabled && !isStrongRuntimeSecret(config.adminApiToken)) {
    errors.push('ADMIN_API_ENABLED=true requires a random ADMIN_API_TOKEN with at least 32 characters.');
  }

  if (config.productionMode && config.chatEncryptionRequired !== true) {
    errors.push('Production requires CHAT_ENCRYPTION_REQUIRED=true.');
  }
  if (config.chatEncryptionRequired && !isStrongRuntimeSecret(config.chatEncryptionKey)) {
    errors.push('CHAT_ENCRYPTION_REQUIRED=true requires a strong CHAT_ENCRYPTION_KEY with at least 32 characters.');
  }
  if (config.productionMode && !isStrongRuntimeSecret(config.logPrivacyKey)) {
    errors.push('Production requires a strong LOG_PRIVACY_KEY with at least 32 characters for stable pseudonymous audit logs.');
  }

  if (config.agentEnabled) {
    if (!(Number(config.billingUsdPerChatCredit) > 0)) {
      errors.push('AGENT_ENABLED=true requires BILLING_USD_PER_CHAT_CREDIT.');
    }
    const workerUrl = String(config.agentWorkerUrl || '');
    if (!/^https:\/\//i.test(workerUrl) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(workerUrl)) {
      errors.push('AGENT_ENABLED=true requires an HTTPS AGENT_WORKER_URL (localhost HTTP is allowed for development).');
    }
    if (!isStrongRuntimeSecret(config.agentWorkerSecret)) {
      errors.push('AGENT_ENABLED=true requires AGENT_WORKER_SECRET with at least 32 characters.');
    }
    if (!/^https:\/\//i.test(String(config.publicBaseUrl || ''))) {
      errors.push('AGENT_ENABLED=true requires an HTTPS PUBLIC_BASE_URL.');
    }
  }

  const githubConfigured = Boolean(
    String(config.githubAppClientId || '').trim() ||
    String(config.githubAppClientSecret || '').trim() ||
    String(config.githubAppSlug || '').trim() ||
    String(config.githubTokenEncryptionKey || '').trim()
  );
  if (config.agentEnabled || githubConfigured) {
    if (!String(config.githubAppClientId || '').trim() || !String(config.githubAppClientSecret || '').trim()) {
      errors.push('GitHub App integration requires GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET.');
    }
    if (!isStrongRuntimeSecret(config.githubTokenEncryptionKey)) {
      errors.push('GitHub App integration requires a dedicated GITHUB_TOKEN_ENCRYPTION_KEY with at least 32 characters.');
    }
    if (
      String(config.githubTokenEncryptionKey || '') &&
      String(config.githubTokenEncryptionKey || '') === String(config.chatEncryptionKey || '')
    ) {
      errors.push('GITHUB_TOKEN_ENCRYPTION_KEY must be different from CHAT_ENCRYPTION_KEY.');
    }
  }

  const supportBotToken = String(config.supportBotToken || '').trim();
  if (config.supportEnabled && supportBotToken) {
    if (supportBotToken === botToken) {
      errors.push('SUPPORT_BOT_TOKEN_CONFLICT: SUPPORT_BOT_TOKEN must be different from BOT_TOKEN.');
    }
    const supportAdminIds = normalizeConfiguredIds(config.supportAdminIds);
    if (supportAdminIds.length === 0) {
      errors.push('MISSING_SUPPORT_ADMIN_IDS: SUPPORT_ADMIN_IDS is required when SUPPORT_BOT_TOKEN is configured.');
    } else if (supportAdminIds.some((id) => !/^[1-9]\d{0,19}$/.test(id))) {
      errors.push('INVALID_SUPPORT_ADMIN_IDS: SUPPORT_ADMIN_IDS must contain positive Telegram user IDs.');
    }
  }

  return errors;
}

export function assertRuntimeConfig(config = {}) {
  const errors = getRuntimeConfigErrors(config);
  if (errors.length > 0) {
    throw new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
  }
}
