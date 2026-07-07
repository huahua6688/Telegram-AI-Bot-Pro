export function getRuntimeConfigErrors(config = {}) {
  const errors = [];

  const botToken = String(config.botToken || '').trim();
  if (!botToken || botToken === 'your_telegram_bot_token') {
    errors.push('BOT_TOKEN is missing or still uses the placeholder value.');
  }

  const provider = String(config.aiProvider || '').toLowerCase();
  const providerChecks = {
    'openai-compatible': [config.aiApiKey, 'AI_API_KEY'],
    anthropic: [config.anthropicApiKey, 'ANTHROPIC_API_KEY or AI_API_KEY'],
    gemini: [config.geminiApiKey, 'GEMINI_API_KEY or AI_API_KEY'],
    'gemini-live': [config.geminiLiveApiKey, 'GEMINI_LIVE_API_KEY, GEMINI_API_KEY, or AI_API_KEY'],
    qwen: [config.qwenApiKey, 'QWEN_API_KEY or AI_API_KEY'],
    grok: [config.grokApiKey, 'GROK_API_KEY or AI_API_KEY'],
    deepseek: [config.deepseekApiKey, 'DEEPSEEK_API_KEY or AI_API_KEY'],
    glm: [config.glmApiKey, 'GLM_API_KEY or AI_API_KEY'],
    doubao: [config.doubaoApiKey, 'DOUBAO_API_KEY or AI_API_KEY']
  };

  const providerCheck = providerChecks[provider];
  if (providerCheck && !String(providerCheck[0] || '').trim()) {
    errors.push(`${provider} requires ${providerCheck[1]}.`);
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
