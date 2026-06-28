import { OpenAICompatibleClient } from './openai-compatible-client.js';
import { AnthropicClient } from './anthropic-client.js';
import { GeminiClient } from './gemini-client.js';

function requireConfigValue(value, name) {
  if (!value) {
    throw new Error(`Missing ${name} in environment.`);
  }
}

export function createAIClient(config, logger) {
  if (config.aiProvider === 'anthropic') {
    requireConfigValue(config.anthropicApiKey, 'ANTHROPIC_API_KEY (or AI_API_KEY)');
    return new AnthropicClient(config, logger);
  }

  if (config.aiProvider === 'gemini') {
    requireConfigValue(config.geminiApiKey, 'GEMINI_API_KEY (or AI_API_KEY)');
    return new GeminiClient(config, logger);
  }

  requireConfigValue(config.aiApiKey, 'AI_API_KEY');
  return new OpenAICompatibleClient(config, logger);
}
