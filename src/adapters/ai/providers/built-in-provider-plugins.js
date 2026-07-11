import { OpenAICompatibleClient } from '../../../services/openai-compatible-client.js';
import { OpenAIClient } from '../../../services/openai-client.js';
import { AnthropicClient } from '../../../services/anthropic-client.js';
import { GeminiClient } from '../../../services/gemini-client.js';
import { GeminiLiveClient } from '../../../services/gemini-live-client.js';
import { GroqClient } from '../../../services/groq-client.js';
import { OpenRouterClient } from '../../../services/openrouter-client.js';
import { GitHubModelsClient } from '../../../services/github-models-client.js';
import { HuggingFaceClient } from '../../../services/huggingface-client.js';
import { MistralClient } from '../../../services/mistral-client.js';
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
      imageEditing: true,
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

function openAIPlugin() {
  return {
    id: 'openai',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: true,
      imageEditing: true,
      speechSynthesis: true,
      speechTranscription: true
    },
    validateConfig: (config) => requireConfigValue(config.openaiApiKey, 'OPENAI_API_KEY (or AI_API_KEY)', 'openai'),
    createClient: (config, logger) => new OpenAIClient(config, logger)
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
    validateConfig: (config) => requireConfigValue(config.geminiLiveApiKey, 'GEMINI_LIVE_API_KEY', 'gemini-live'),
    createClient: (config, logger) => new GeminiLiveClient(config, logger)
  };
}

function groqPlugin() {
  return {
    id: 'groq',
    capabilities: {
      chat: true,
      toolCalls: true
    },
    validateConfig: (config) => requireConfigValue(config.groqApiKey, 'GROQ_API_KEY', 'groq'),
    createClient: (config, logger) => new GroqClient(config, logger)
  };
}

function openRouterPlugin() {
  return {
    id: 'openrouter',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true
    },
    validateConfig: (config) => requireConfigValue(config.openrouterApiKey, 'OPENROUTER_API_KEY', 'openrouter'),
    createClient: (config, logger) => new OpenRouterClient(config, logger)
  };
}

function githubModelsPlugin() {
  return {
    id: 'github-models',
    capabilities: {
      chat: true,
      toolCalls: true,
      vision: true
    },
    validateConfig: (config) => requireConfigValue(config.githubModelsApiKey, 'GITHUB_MODELS_API_KEY (or GITHUB_TOKEN)', 'github-models'),
    createClient: (config, logger) => new GitHubModelsClient(config, logger)
  };
}

function huggingFacePlugin() {
  return {
    id: 'huggingface',
    capabilities: {
      chat: true
    },
    validateConfig: (config) => requireConfigValue(config.huggingfaceApiKey, 'HUGGINGFACE_API_KEY (or HF_TOKEN)', 'huggingface'),
    createClient: (config, logger) => new HuggingFaceClient(config, logger)
  };
}

function mistralPlugin() {
  return {
    id: 'mistral',
    capabilities: {
      chat: true,
      toolCalls: true
    },
    validateConfig: (config) => requireConfigValue(config.mistralApiKey, 'MISTRAL_API_KEY', 'mistral'),
    createClient: (config, logger) => new MistralClient(config, logger)
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
  openAIPlugin,
  anthropicPlugin,
  geminiPlugin,
  geminiLivePlugin,
  groqPlugin,
  openRouterPlugin,
  githubModelsPlugin,
  huggingFacePlugin,
  mistralPlugin,
  qwenPlugin,
  grokPlugin,
  deepSeekPlugin,
  glmPlugin,
  doubaoPlugin
];
