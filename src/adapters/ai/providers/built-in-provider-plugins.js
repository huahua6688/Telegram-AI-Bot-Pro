import { OpenAICompatibleClient } from '../../../services/openai-compatible-client.js';
import { AnthropicClient } from '../../../services/anthropic-client.js';
import { GeminiClient } from '../../../services/gemini-client.js';
import { GeminiLiveClient } from '../../../services/gemini-live-client.js';
import { QwenClient } from '../../../services/qwen-client.js';
import { GrokClient } from '../../../services/grok-client.js';
import { DeepSeekClient } from '../../../services/deepseek-client.js';
import { GLMClient } from '../../../services/glm-client.js';
import { DoubaoClient } from '../../../services/doubao-client.js';

function requireConfigValue(value, name, providerId = '') {
  if (!value) {
    const providerHint = providerId ? ` (AI_PROVIDER=${providerId})` : '';
    throw new Error(`Missing ${name} in environment${providerHint}.`);
  }
}

function openAICompatiblePlugin() {
  return {
    id: 'openai-compatible',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: true,
      speechSynthesis: true,
      speechTranscription: true,
      nativeAudio: false
    },
    validateConfig: (config) => {
      if (!config.aiApiKey) {
        throw new Error('Missing AI_API_KEY in environment (AI_PROVIDER=openai-compatible).');
      }
    },
    createClient: (config, logger) => new OpenAICompatibleClient(config, logger)
  };
}

function anthropicPlugin() {
  return {
    id: 'anthropic',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true
    },
    validateConfig: (config) => requireConfigValue(config.anthropicApiKey, 'ANTHROPIC_API_KEY (or AI_API_KEY)', 'anthropic'),
    createClient: (config, logger) => new AnthropicClient(config, logger)
  };
}

function geminiPlugin() {
  return {
    id: 'gemini',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true
    },
    validateConfig: (config) => requireConfigValue(config.geminiApiKey, 'GEMINI_API_KEY (or AI_API_KEY)', 'gemini'),
    createClient: (config, logger) => new GeminiClient(config, logger)
  };
}

function geminiLivePlugin() {
  return {
    id: 'gemini-live',
    capabilities: {
      chat: true,
      vision: true,
      speechSynthesis: true,
      speechTranscription: true,
      liveAudio: true,
      nativeAudio: true
    },
    validateConfig: (config) => requireConfigValue(config.geminiLiveApiKey, 'GEMINI_LIVE_API_KEY (or GEMINI_API_KEY / AI_API_KEY)', 'gemini-live'),
    createClient: (config, logger) => new GeminiLiveClient(config, logger)
  };
}

function qwenPlugin() {
  return {
    id: 'qwen',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true
    },
    validateConfig: (config) => requireConfigValue(config.qwenApiKey, 'QWEN_API_KEY (or AI_API_KEY)', 'qwen'),
    createClient: (config, logger) => new QwenClient(config, logger)
  };
}

function grokPlugin() {
  return {
    id: 'grok',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true
    },
    validateConfig: (config) => requireConfigValue(config.grokApiKey, 'GROK_API_KEY (or AI_API_KEY)', 'grok'),
    createClient: (config, logger) => new GrokClient(config, logger)
  };
}

function deepSeekPlugin() {
  return {
    id: 'deepseek',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true
    },
    validateConfig: (config) => requireConfigValue(config.deepseekApiKey, 'DEEPSEEK_API_KEY (or AI_API_KEY)', 'deepseek'),
    createClient: (config, logger) => new DeepSeekClient(config, logger)
  };
}

function glmPlugin() {
  return {
    id: 'glm',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true
    },
    validateConfig: (config) => requireConfigValue(config.glmApiKey, 'GLM_API_KEY (or AI_API_KEY)', 'glm'),
    createClient: (config, logger) => new GLMClient(config, logger)
  };
}

function doubaoPlugin() {
  return {
    id: 'doubao',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true
    },
    validateConfig: (config) => requireConfigValue(config.doubaoApiKey, 'DOUBAO_API_KEY (or AI_API_KEY)', 'doubao'),
    createClient: (config, logger) => new DoubaoClient(config, logger)
  };
}

export const builtInProviderPlugins = [
  openAICompatiblePlugin,
  anthropicPlugin,
  geminiPlugin,
  geminiLivePlugin,
  qwenPlugin,
  grokPlugin,
  deepSeekPlugin,
  glmPlugin,
  doubaoPlugin
];
