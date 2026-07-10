import { createAIClient } from './ai-client-factory.js';
import {
  ensureBuiltInAIProvidersRegistered,
  getAIProviderDefinition,
  listAIProviderDefinitions
} from './ai-provider-registry.js';

export const PROVIDER_LABELS = Object.freeze({
  auto: 'Auto',
  gemini: 'Gemini',
  'gemini-live': 'Gemini Live',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  'github-models': 'GitHub Models',
  huggingface: 'Hugging Face',
  mistral: 'Mistral',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI Compatible',
  anthropic: 'Claude',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  grok: 'Grok',
  glm: 'GLM',
  doubao: 'Doubao'
});

const CONFIG_KEY_BY_PROVIDER = Object.freeze({
  gemini: 'geminiApiKey',
  'gemini-live': 'geminiLiveApiKey',
  groq: 'groqApiKey',
  openrouter: 'openrouterApiKey',
  'github-models': 'githubModelsApiKey',
  huggingface: 'huggingfaceApiKey',
  mistral: 'mistralApiKey',
  openai: 'openaiApiKey',
  'openai-compatible': 'aiApiKey',
  anthropic: 'anthropicApiKey',
  deepseek: 'deepseekApiKey',
  qwen: 'qwenApiKey',
  grok: 'grokApiKey',
  glm: 'glmApiKey',
  doubao: 'doubaoApiKey'
});

const CAPABILITY_ALIASES = Object.freeze({
  text: 'chat',
  chat: 'chat',
  vision: 'vision',
  image: 'vision',
  imageGeneration: 'imageGeneration',
  imageEditing: 'imageEditing',
  speechSynthesis: 'speechSynthesis',
  speechTranscription: 'speechTranscription',
  liveAudio: 'liveAudio',
  translation: 'chat',
  router: 'chat',
  memory: 'chat'
});

function compactList(...values) {
  return Array.from(
    new Set(
      values
        .flat()
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProviderId(providerId = '') {
  return String(providerId || '').trim().toLowerCase();
}

export function classifyProviderError(error) {
  const raw = String(error?.message || error || '');
  const lower = raw.toLowerCase();

  if (/\b401\b/.test(raw) || lower.includes('unauthorized') || lower.includes('invalid api key')) return 'auth';
  if (/\b403\b/.test(raw) || lower.includes('permission') || lower.includes('forbidden')) return 'permission';
  if (/\b404\b/.test(raw) || lower.includes('model') && lower.includes('not found')) return 'model';
  if (/\b408\b/.test(raw) || lower.includes('timeout') || lower.includes('aborted')) return 'timeout';
  if (/\b429\b/.test(raw) || lower.includes('quota') || lower.includes('rate limit') || lower.includes('resource_exhausted')) return 'quota';
  if (/\b5\d\d\b/.test(raw) || lower.includes('econnreset') || lower.includes('fetch failed') || lower.includes('network')) return 'transient';
  if (lower.includes('empty response') || lower.includes('did not return')) return 'empty';
  if (lower.includes('safety') || lower.includes('content filter') || lower.includes('blocked')) return 'safety';
  if (lower.includes('unsupported')) return 'unsupported';
  return 'unknown';
}

export class AIProviderManager {
  constructor({ config, logger, db = null, clientFactory = createAIClient } = {}) {
    this.config = config;
    this.logger = logger || console;
    this.db = db;
    this.clientFactory = clientFactory;
    this.clients = new Map();
    this.health = new Map();
    ensureBuiltInAIProvidersRegistered();
  }

  normalizeCapability(capability = 'chat') {
    return CAPABILITY_ALIASES[capability] || capability || 'chat';
  }

  getProviderLabel(providerId = '') {
    return PROVIDER_LABELS[providerId] || providerId || 'unknown';
  }

  getProviderModels(providerId = '') {
    const id = normalizeProviderId(providerId);
    return compactList(
      this.config.providerModels?.[id] || [],
      id === this.config.aiProvider ? this.config.availableModels || [] : [],
      this.config.providerDefaultModels?.[id] || ''
    );
  }

  getDefaultModel(providerId = '') {
    return this.getProviderModels(providerId)[0] || this.config.defaultModel || '';
  }

  isConfigured(providerId = '') {
    const id = normalizeProviderId(providerId);
    const key = CONFIG_KEY_BY_PROVIDER[id];
    if (!key) return false;
    return Boolean(String(this.config[key] || '').trim());
  }

  isEnabled(providerId = '') {
    const id = normalizeProviderId(providerId);
    const row = this.db?.listProviderConfigs?.().find((item) => item.providerId === id);
    return row ? Boolean(row.enabled) : true;
  }

  getCooldown(providerId = '', capability = 'chat') {
    const id = normalizeProviderId(providerId);
    const key = `${id}:${this.normalizeCapability(capability)}`;
    const state = this.health.get(key);
    if (!state?.cooldownUntil) return null;
    if (Date.now() >= state.cooldownUntil) return null;
    return state;
  }

  setHealth(providerId, capability, patch = {}) {
    const id = normalizeProviderId(providerId);
    const key = `${id}:${this.normalizeCapability(capability)}`;
    const existing = this.health.get(key) || { providerId: id, capability: this.normalizeCapability(capability) };
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.health.set(key, next);
    return next;
  }

  setCooldown(providerId, capability, error, cooldownMs = this.config.aiProviderCooldownMs) {
    const type = classifyProviderError(error);
    return this.setHealth(providerId, capability, {
      status: 'cooldown',
      cooldownUntil: Date.now() + Math.max(1000, Number(cooldownMs) || 60000),
      lastFailureAt: new Date().toISOString(),
      lastErrorType: type,
      consecutiveFailures: (this.health.get(`${providerId}:${this.normalizeCapability(capability)}`)?.consecutiveFailures || 0) + 1
    });
  }

  markSuccess(providerId, capability) {
    return this.setHealth(providerId, capability, {
      status: 'healthy',
      cooldownUntil: 0,
      lastSuccessAt: new Date().toISOString(),
      consecutiveFailures: 0,
      lastErrorType: ''
    });
  }

  getProviderCapabilities(providerId = '') {
    const definition = getAIProviderDefinition(normalizeProviderId(providerId));
    return definition?.capabilities || {};
  }

  providerSupports(providerId = '', capability = 'chat') {
    const normalizedCapability = this.normalizeCapability(capability);
    const capabilities = this.getProviderCapabilities(providerId);
    return Boolean(capabilities[normalizedCapability]);
  }

  hasAvailableProvider(capability = 'chat', preferredProvider = '') {
    return Boolean(this.selectProvider({ capability, preferredProvider, fallbackEnabled: true }));
  }

  createProviderConfig(providerId = '', model = '') {
    const id = normalizeProviderId(providerId);
    const models = this.getProviderModels(id);
    const defaultModel = model || models[0] || this.config.defaultModel;
    return {
      ...this.config,
      aiProvider: id,
      defaultModel,
      availableModels: compactList(defaultModel, models)
    };
  }

  getClientForProvider(providerId = '', model = '') {
    const id = normalizeProviderId(providerId);
    if (!id || id === 'auto') return null;
    const cacheKey = `${id}:${model || this.getDefaultModel(id)}`;
    if (this.clients.has(cacheKey)) return this.clients.get(cacheKey);
    const client = this.clientFactory(this.createProviderConfig(id, model), this.logger);
    this.clients.set(cacheKey, client);
    return client;
  }

  listProviders() {
    return listAIProviderDefinitions()
      .map((definition) => {
        const configured = this.isConfigured(definition.id);
        const enabled = this.isEnabled(definition.id);
        const cooldown = this.getCooldown(definition.id, 'chat');
        const status = !enabled
          ? 'disabled'
          : !configured
            ? 'unconfigured'
            : cooldown
              ? 'cooldown'
              : this.health.get(`${definition.id}:chat`)?.status || 'healthy';
        return {
          id: definition.id,
          name: this.getProviderLabel(definition.id),
          configured,
          enabled,
          status,
          models: this.getProviderModels(definition.id),
          capabilities: definition.capabilities
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getDedicatedProviderForCapability(capability = 'chat') {
    const normalized = this.normalizeCapability(capability);
    const map = {
      chat: this.config.aiProvider,
      vision: this.config.visionProvider,
      imageGeneration: this.config.imageProvider,
      imageEditing: this.config.imageProvider,
      speechTranscription: this.config.transcriptionProvider,
      speechSynthesis: this.config.ttsProvider,
      liveAudio: 'gemini-live',
      translation: this.config.translationProvider,
      router: this.config.routerProvider,
      memory: this.config.memoryProvider
    };
    return map[capability] || map[normalized] || this.config.aiProvider;
  }

  buildProviderOrder({ capability = 'chat', preferredProvider = '', fallbackEnabled = true } = {}) {
    const normalizedCapability = this.normalizeCapability(capability);
    const preferred = normalizeProviderId(preferredProvider);
    const dedicated = normalizeProviderId(this.getDedicatedProviderForCapability(capability));
    const defaultProvider = normalizeProviderId(this.config.aiProvider);
    const fallbackOrder = this.config.aiProviderFallbackOrder || [];
    const allConfigured = this.listProviders()
      .filter((item) => item.configured && item.enabled)
      .map((item) => item.id);

    if (preferred && preferred !== 'auto' && !fallbackEnabled) {
      return [preferred];
    }

    const base = preferred && preferred !== 'auto'
      ? [preferred, dedicated, defaultProvider]
      : [dedicated, defaultProvider, ...fallbackOrder];

    return compactList(base, fallbackEnabled || preferred === 'auto' ? fallbackOrder : [], allConfigured)
      .filter((providerId) => providerId !== 'auto')
      .filter((providerId) => this.providerSupports(providerId, normalizedCapability));
  }

  selectProvider({ capability = 'chat', preferredProvider = '', fallbackEnabled = true } = {}) {
    const order = this.buildProviderOrder({ capability, preferredProvider, fallbackEnabled });
    for (const providerId of order) {
      if (!this.isEnabled(providerId) || !this.isConfigured(providerId)) continue;
      if (this.getCooldown(providerId, capability)) continue;
      try {
        const model = this.getCandidateModels(providerId)[0];
        if (!model) continue;
        const client = this.getClientForProvider(providerId, model);
        return {
          providerId,
          providerName: client.getProviderName?.() || providerId,
          model,
          client,
          capabilities: client.getCapabilities?.() || this.getProviderCapabilities(providerId)
        };
      } catch (error) {
        this.setHealth(providerId, capability, {
          status: 'unconfigured',
          lastFailureAt: new Date().toISOString(),
          lastErrorType: classifyProviderError(error)
        });
      }
    }
    return null;
  }

  getCandidateModels(providerId = '', preferredModel = '') {
    const id = normalizeProviderId(providerId);
    return compactList(
      preferredModel,
      this.getProviderModels(id),
      id === normalizeProviderId(this.config.aiProvider) ? this.config.defaultModel : ''
    );
  }

  async execute({
    userId = '',
    capability = 'chat',
    preferredProvider = '',
    preferredModel = '',
    fallbackEnabled = this.config.enableProviderFallback,
    request = {},
    scope = 'chat'
  } = {}) {
    const providerOrder = this.buildProviderOrder({ capability, preferredProvider, fallbackEnabled });
    const attempted = [];
    let lastError = null;

    for (const providerId of providerOrder) {
      if (!this.isEnabled(providerId)) {
        attempted.push({ providerId, status: 'disabled' });
        continue;
      }
      if (!this.isConfigured(providerId)) {
        attempted.push({ providerId, status: 'unconfigured' });
        continue;
      }
      if (this.getCooldown(providerId, capability)) {
        attempted.push({ providerId, status: 'cooldown' });
        continue;
      }

      const modelCandidates = this.getCandidateModels(
        providerId,
        providerId === normalizeProviderId(preferredProvider) ? preferredModel : ''
      );
      if (modelCandidates.length === 0) {
        attempted.push({ providerId, status: 'model_missing' });
        continue;
      }
      const maxAttempts = Math.max(1, Number(this.config.aiProviderMaxRetries || 1));

      for (const model of modelCandidates) {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const client = this.getClientForProvider(providerId, model);
            const capabilities = client.getCapabilities?.() || this.getProviderCapabilities(providerId);
            const providerRequest = capabilities.toolCalls ? request : { ...request, tools: [] };
            const result = await client.completeWithTools({
              ...providerRequest,
              model
            });
            if (!String(result?.text || '').trim()) {
              throw new Error('AI provider returned an empty response.');
            }
            this.markSuccess(providerId, capability);
            const originallyPreferred = normalizeProviderId(preferredProvider || this.config.aiProvider);
            return {
              result,
              providerId,
              providerName: client.getProviderName?.() || providerId,
              model,
              switched: Boolean(originallyPreferred && originallyPreferred !== 'auto' && originallyPreferred !== providerId),
              attempted
            };
          } catch (error) {
            lastError = error;
            const errorType = classifyProviderError(error);
            attempted.push({ providerId, model, attempt, status: errorType, message: error.message });
            const retryable = ['timeout', 'quota', 'transient', 'empty', 'unknown'].includes(errorType);

            if (attempt < maxAttempts && retryable) {
              await sleep(Math.max(0, Number(this.config.aiProviderRetryDelayMs) || 0));
              continue;
            }

            const cooldownMs = errorType === 'model' || errorType === 'auth' || errorType === 'permission'
              ? Math.max(300000, Number(this.config.aiProviderCooldownMs) || 60000)
              : this.config.aiProviderCooldownMs;
            this.setCooldown(providerId, capability, error, cooldownMs);
            this.logger.warn?.('AI provider failed, trying next candidate', {
              userId: String(userId || ''),
              scope,
              providerId,
              model,
              errorType,
              error: error.message
            });
            break;
          }
        }

        if (!fallbackEnabled && normalizeProviderId(preferredProvider) !== 'auto') {
          break;
        }
      }

      if (!fallbackEnabled && normalizeProviderId(preferredProvider) !== 'auto') {
        break;
      }
    }

    const onlySetupProblems = attempted.length > 0 && attempted.every((item) =>
      ['unconfigured', 'disabled', 'model_missing', 'cooldown'].includes(String(item.status || ''))
    );
    const message = attempted.length
      ? onlySetupProblems
        ? `No usable AI provider is configured: ${attempted.map((item) => `${item.providerId}/${item.status}`).join(', ')}`
        : `All configured AI providers failed: ${attempted.map((item) => `${item.providerId}/${item.status}`).join(', ')}`
      : 'No configured AI provider supports this request.';
    const wrapped = new Error(message);
    wrapped.code = onlySetupProblems ? 'NO_USABLE_AI_PROVIDER' : 'AI_PROVIDERS_FAILED';
    wrapped.cause = lastError;
    wrapped.attemptedProviders = attempted;
    throw wrapped;
  }
}

export function createAIProviderManager(config, logger, db = null) {
  return new AIProviderManager({ config, logger, db });
}
