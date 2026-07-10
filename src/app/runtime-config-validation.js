export function getRuntimeConfigErrors(config = {}) {
  const errors = [];

  const botToken = String(config.botToken || '').trim();
  if (!botToken || botToken === 'your_telegram_bot_token') {
    errors.push('BOT_TOKEN is missing or still uses the placeholder value.');
  }

  if (!String(config.defaultModel || '').trim()) {
    errors.push('AI_MODEL is missing.');
  }

  if (config.adminApiEnabled && !String(config.adminApiToken || '').trim()) {
    errors.push('ADMIN_API_ENABLED=true requires ADMIN_API_TOKEN.');
  }

  return errors;
}

export function assertRuntimeConfig(config = {}) {
  const errors = getRuntimeConfigErrors(config);
  if (errors.length > 0) {
    throw new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
  }
}
