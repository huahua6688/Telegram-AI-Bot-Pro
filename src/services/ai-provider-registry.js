import { OpenAICompatibleClient } from './openai-compatible-client.js';
import { AnthropicClient } from './anthropic-client.js';
import { GeminiClient } from './gemini-client.js';
import { GeminiLiveClient } from './gemini-live-client.js';
import { QwenClient } from './qwen-client.js';
import { GrokClient } from './grok-client.js';
import { DeepSeekClient } from './deepseek-client.js';
import { GLMClient } from './glm-client.js';
import { DoubaoClient } from './doubao-client.js';

const providerRegistry = new Map();

function requireConfigValue(value, name, providerId = '') {
  if (!value) {
    const providerHint = providerId ? ` (AI_PROVIDER=${providerId})` : '';
    throw new Error(`Missing ${name} in environment${providerHint}.`);
  }
}

export function registerAIProvider(definition) {
  if (!definition?.id) {
    throw new Error('Provider definition requires an id.');
  }
  if (typeof definition.createClient !== 'function') {
    throw new Error(`Provider ${definition.id} requires createClient.`);
  }
  providerRegistry.set(definition.id, definition);
}

export function getAIProviderDefinition(providerId) {
  return providerRegistry.get(providerId);
}

export function listAIProviderDefinitions() {
  return [...providerRegistry.values()];
}

let initialized = false;
export function ensureBuiltInAIProvidersRegistered() {
  if (initialized) return;
  initialized = true;

  registerAIProvider({
    id: 'openai-compatible',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: true,
      speechSynthesis: true,
      speechTranscription: true
    },
    validateConfig: (config) => {
      if (!config.aiApiKey) {
        const otherProviders = listAIProviderDefinitions()
          .map((p) => p.id)
          .filter((id) => id !== 'openai-compatible')
          .sort()
          .join(', ');
        throw new Error(
          'Missing AI_API_KEY in environment (AI_PROVIDER=openai-compatible). ' +
          `Set AI_API_KEY, or set AI_PROVIDER to one of: ${otherProviders}`
        );
      }
    },
    createClient: (config, logger) => new OpenAICompatibleClient(config, logger)
  });

  registerAIProvider({
    id: 'anthropic',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: false,
      speechSynthesis: false,
      speechTranscription: false
    },
    validateConfig: (config) => requireConfigValue(config.anthropicApiKey, 'ANTHROPIC_API_KEY (or AI_API_KEY)', 'anthropic'),
    createClient: (config, logger) => new AnthropicClient(config, logger)
  });

  registerAIProvider({
    id: 'gemini',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: false,
      speechSynthesis: false,
      speechTranscription: false
    },
    validateConfig: (config) => requireConfigValue(config.geminiApiKey, 'GEMINI_API_KEY (or AI_API_KEY)', 'gemini'),
    createClient: (config, logger) => new GeminiClient(config, logger)
  });

  registerAIProvider({
    id: 'gemini-live',
    capabilities: {
      chat: true,
      toolCalls: false,
      vision: true,
      imageGeneration: false,
      speechSynthesis: true,
      speechTranscription: true
    },
    validateConfig: (config) => requireConfigValue(config.geminiLiveApiKey, 'GEMINI_LIVE_API_KEY (or GEMINI_API_KEY / AI_API_KEY)', 'gemini-live'),
    createClient: (config, logger) => new GeminiLiveClient(config, logger)
  });

  registerAIProvider({
    id: 'qwen',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: false,
      speechSynthesis: false,
      speechTranscription: false
    },
    validateConfig: (config) => requireConfigValue(config.qwenApiKey, 'QWEN_API_KEY (or AI_API_KEY)', 'qwen'),
    createClient: (config, logger) => new QwenClient(config, logger)
  });

  registerAIProvider({
    id: 'grok',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: false,
      speechSynthesis: false,
      speechTranscription: false
    },
    validateConfig: (config) => requireConfigValue(config.grokApiKey, 'GROK_API_KEY (or AI_API_KEY)', 'grok'),
    createClient: (config, logger) => new GrokClient(config, logger)
  });

  registerAIProvider({
    id: 'deepseek',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: false,
      speechSynthesis: false,
      speechTranscription: false
    },
    validateConfig: (config) => requireConfigValue(config.deepseekApiKey, 'DEEPSEEK_API_KEY (or AI_API_KEY)', 'deepseek'),
    createClient: (config, logger) => new DeepSeekClient(config, logger)
  });

  registerAIProvider({
    id: 'glm',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: false,
      speechSynthesis: false,
      speechTranscription: false
    },
    validateConfig: (config) => requireConfigValue(config.glmApiKey, 'GLM_API_KEY (or AI_API_KEY)', 'glm'),
    createClient: (config, logger) => new GLMClient(config, logger)
  });

  registerAIProvider({
    id: 'doubao',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: false,
      speechSynthesis: false,
      speechTranscription: false
    },
    validateConfig: (config) => requireConfigValue(config.doubaoApiKey, 'DOUBAO_API_KEY (or AI_API_KEY)', 'doubao'),
    createClient: (config, logger) => new DoubaoClient(config, logger)
  });
}
