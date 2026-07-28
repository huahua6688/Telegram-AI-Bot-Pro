export const SMART_ROUTER_POLICY_VERSION = 'smart-router-v1';

export const SMART_ROUTER_TASK_TYPES = Object.freeze([
  'general_chat',
  'translation',
  'coding',
  'debugging',
  'reasoning',
  'long_context',
  'document_analysis',
  'summarization',
  'vision',
  'ocr',
  'image_generation',
  'speech_to_text',
  'text_to_speech',
  'live_voice',
  'web_research',
  'tool_calling',
  'cheap_fallback'
]);

const ROUTE_KEY_BY_TASK = Object.freeze({
  general_chat: 'general',
  translation: 'translation',
  coding: 'code',
  debugging: 'code',
  reasoning: 'reasoning',
  long_context: 'long_context',
  document_analysis: 'document',
  summarization: 'document',
  vision: 'vision',
  ocr: 'ocr',
  web_research: 'tool',
  tool_calling: 'tool',
  cheap_fallback: 'cheap'
});

const TASK_CAPABILITIES = Object.freeze({
  vision: 'vision',
  ocr: 'vision',
  image_generation: 'imageGeneration',
  speech_to_text: 'speechTranscription',
  text_to_speech: 'speechSynthesis',
  live_voice: 'liveAudio',
  web_research: 'toolCalls',
  tool_calling: 'toolCalls'
});

const MODE_TASKS = Object.freeze({
  translate: 'translation',
  translation: 'translation',
  coding: 'coding',
  code: 'coding',
  debug: 'debugging',
  debugging: 'debugging',
  reason: 'reasoning',
  reasoning: 'reasoning',
  long_context: 'long_context',
  document: 'document_analysis',
  document_analysis: 'document_analysis',
  summarize: 'summarization',
  summarization: 'summarization',
  vision: 'vision',
  image_understanding: 'vision',
  ocr: 'ocr',
  image: 'image_generation',
  image_generation: 'image_generation',
  speech_to_text: 'speech_to_text',
  transcription: 'speech_to_text',
  text_to_speech: 'text_to_speech',
  tts: 'text_to_speech',
  live: 'live_voice',
  live_voice: 'live_voice',
  web: 'web_research',
  web_search: 'web_research',
  web_research: 'web_research',
  tools: 'tool_calling',
  tool_calling: 'tool_calling',
  cheap: 'cheap_fallback',
  cheap_fallback: 'cheap_fallback'
});

function asString(value = '') {
  return String(value ?? '').trim();
}

function normalizeProviderId(value = '') {
  const provider = asString(value).toLowerCase();
  if (provider === 'google') return 'gemini';
  if (provider === 'google-live' || provider === 'gemini_live') return 'gemini-live';
  if (provider === 'claude') return 'anthropic';
  if (provider === 'compatible' || provider === 'custom') return 'openai-compatible';
  if (provider === 'open-router') return 'openrouter';
  if (provider === 'github' || provider === 'github_models') return 'github-models';
  if (provider === 'hf' || provider === 'hugging-face') return 'huggingface';
  if (provider === 'mistral-ai') return 'mistral';
  if (provider === 'tongyi' || provider === 'dashscope') return 'qwen';
  if (provider === 'xai') return 'grok';
  if (provider === 'zhipu' || provider === 'chatglm') return 'glm';
  if (provider === 'ark' || provider === 'volcengine') return 'doubao';
  return provider;
}

function clampConfidence(value, fallback = 0.55) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeCapabilities(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((item) => [asString(item), true]).filter(([key]) => key));
  }
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, enabled]) => [asString(key), Boolean(enabled)])
      .filter(([key]) => key)
  );
}

function normalizeTaskType(value = '') {
  const taskType = asString(value).toLowerCase();
  return SMART_ROUTER_TASK_TYPES.includes(taskType) ? taskType : '';
}

function textLengthFromContext(conversationContext = {}) {
  const candidates = [
    conversationContext.totalChars,
    conversationContext.textLength,
    conversationContext.contextChars,
    conversationContext.historyChars
  ];
  return candidates.reduce((maximum, value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(maximum, parsed) : maximum;
  }, 0);
}

function classifyFromMode(mode = '') {
  const normalized = asString(mode).toLowerCase().replace(/[\s-]+/g, '_');
  return MODE_TASKS[normalized] || '';
}

function hasDocumentAttachment(messageType = '', attachmentType = '') {
  const type = `${messageType} ${attachmentType}`.toLowerCase();
  return /\b(?:pdf|document|doc|docx|file|spreadsheet|xlsx|xls|csv)\b/.test(type);
}

function hasImageAttachment(messageType = '', attachmentType = '') {
  const type = `${messageType} ${attachmentType}`.toLowerCase();
  return /\b(?:photo|image|picture|screenshot)\b/.test(type);
}

function hasAudioAttachment(messageType = '', attachmentType = '') {
  const type = `${messageType} ${attachmentType}`.toLowerCase();
  return /\b(?:audio|voice|speech|sound)\b/.test(type) && !type.includes('transcribed_audio');
}

function isOcrRequest(text = '') {
  return /(?:\bocr\b|extract\s+(?:the\s+)?text|read\s+(?:the\s+)?text|recognize\s+(?:the\s+)?text|提取(?:图片|圖像|图像|照片)?文字|识别(?:图片|圖像|图像|照片)?文字|識別(?:圖片|圖像|照片)?文字|读取图片文字|讀取圖片文字)/i.test(text);
}

function isTranslationRequest(text = '') {
  return /(?:\btranslate\b|\btranslation\b|翻译|翻譯|译成|譯成|怎么说|怎麼說|改成(?:英文|中文|日文|韩文|韓文|法文|德文)|into\s+(?:english|chinese|japanese|korean|french|german|spanish))/i.test(text);
}

function isDebuggingRequest(text = '') {
  return /(?:\b(?:debug|debugging|stack\s*trace|traceback|exception|segmentation fault|uncaught|fatal error)\b|报错|報錯|错误日志|錯誤日誌|为什么.*(?:错误|失敗|失败)|\b(?:typeerror|referenceerror|syntaxerror|rangeerror)\b|(?:^|\n)\s*at\s+\S+\s*\(.+:\d+:\d+\))/im.test(text);
}

function isCodingRequest(text = '') {
  return /```[\s\S]*?```|(?:\b(?:write|review|refactor|implement|compile|function|class|typescript|javascript|python|golang|rust|sql|regex|api|code)\b|编程|編程|代码|代碼|写个程序|寫個程式|代码审查|代碼審查)/i.test(text);
}

function isReasoningRequest(text = '') {
  return /(?:\b(?:prove|derive|reason step by step|logic puzzle|mathematical|optimization|probability|calculate|equation)\b|推理|证明|證明|数学分析|數學分析|逻辑分析|邏輯分析|概率|几何|幾何|方程|逐步推导|逐步推導)/i.test(text);
}

function isSummarizationRequest(text = '') {
  return /(?:\b(?:summarize|summary|key points|tl;dr|condense)\b|总结|總結|概括|摘要|提取重点|提取重點)/i.test(text);
}

function isWebResearchRequest(text = '') {
  return /(?:\b(?:search|look up|latest|today'?s|current|real[- ]?time|breaking news|news today|exchange rate|stock price|weather now)\b|联网|聯網|搜索|搜尋|搜一下|查一下|最新|今天(?:的)?新闻|今日新闻|今日新聞|实时|實時|当前价格|當前價格|最新汇率|最新匯率)/i.test(text);
}

function isToolCallingRequest(text = '') {
  return /(?:\b(?:use|call|run)\s+(?:a\s+|the\s+)?tool\b|\btool\s+call\b|调用工具|調用工具|使用工具)/i.test(text);
}

function isImageGenerationRequest(text = '') {
  return /(?:\b(?:generate|create|draw|make)\s+(?:an?\s+)?(?:image|picture|illustration|logo|poster)\b|生成(?:一张|一張)?(?:图片|圖片|图像|圖像|海报|海報|插画|插畫)|画一张|畫一張)/i.test(text);
}

function isTextToSpeechRequest(text = '') {
  return /(?:\b(?:text[- ]to[- ]speech|tts|read (?:this|it) aloud|speak this)\b|文字转语音|文字轉語音|朗读|朗讀|念出来|念出來)/i.test(text);
}

function isLiveVoiceRequest(text = '') {
  return /(?:\b(?:live voice|real[- ]?time voice|live audio|voice conversation)\b|实时语音|實時語音|语音通话|語音通話)/i.test(text);
}

function isCheapFallbackRequest(text = '') {
  return /(?:\b(?:cheapest|lowest cost|low[- ]cost model|economy model)\b|最便宜|最低成本|低成本模型|省额度|省額度)/i.test(text);
}

export function classifyTask({
  text = '',
  messageType = 'text',
  attachmentType = '',
  mode = '',
  conversationContext = {}
} = {}) {
  const content = asString(text);
  const explicitModeTask = classifyFromMode(mode);
  if (explicitModeTask) {
    return {
      taskType: explicitModeTask,
      confidence: 0.99,
      reason: `mode_${explicitModeTask}`
    };
  }

  if (hasImageAttachment(messageType, attachmentType)) {
    return isOcrRequest(content)
      ? { taskType: 'ocr', confidence: 0.99, reason: 'image_with_ocr_request' }
      : { taskType: 'vision', confidence: 0.98, reason: 'image_attachment' };
  }
  if (hasDocumentAttachment(messageType, attachmentType)) {
    return isSummarizationRequest(content)
      ? { taskType: 'summarization', confidence: 0.98, reason: 'document_summary_request' }
      : { taskType: 'document_analysis', confidence: 0.98, reason: 'document_attachment' };
  }
  if (hasAudioAttachment(messageType, attachmentType)) {
    return { taskType: 'speech_to_text', confidence: 0.98, reason: 'audio_attachment' };
  }
  if (isLiveVoiceRequest(content)) {
    return { taskType: 'live_voice', confidence: 0.97, reason: 'live_voice_request' };
  }
  if (isImageGenerationRequest(content)) {
    return { taskType: 'image_generation', confidence: 0.96, reason: 'image_generation_request' };
  }
  if (isTextToSpeechRequest(content)) {
    return { taskType: 'text_to_speech', confidence: 0.96, reason: 'text_to_speech_request' };
  }
  if (isOcrRequest(content)) {
    return { taskType: 'ocr', confidence: 0.92, reason: 'ocr_request' };
  }
  if (isTranslationRequest(content)) {
    return { taskType: 'translation', confidence: 0.94, reason: 'translation_request' };
  }
  if (isDebuggingRequest(content)) {
    return { taskType: 'debugging', confidence: 0.95, reason: 'debugging_request' };
  }
  if (isCodingRequest(content)) {
    return { taskType: 'coding', confidence: 0.92, reason: 'coding_request' };
  }
  if (isWebResearchRequest(content)) {
    return { taskType: 'web_research', confidence: 0.93, reason: 'web_research_request' };
  }
  if (isToolCallingRequest(content)) {
    return { taskType: 'tool_calling', confidence: 0.9, reason: 'tool_calling_request' };
  }
  if (isReasoningRequest(content)) {
    return { taskType: 'reasoning', confidence: 0.9, reason: 'reasoning_request' };
  }
  if (isCheapFallbackRequest(content)) {
    return { taskType: 'cheap_fallback', confidence: 0.88, reason: 'cheap_model_request' };
  }
  if (isSummarizationRequest(content)) {
    return { taskType: 'summarization', confidence: 0.88, reason: 'summarization_request' };
  }

  const totalLength = Math.max(content.length, textLengthFromContext(conversationContext));
  if (totalLength >= 6000) {
    return { taskType: 'long_context', confidence: 0.84, reason: 'long_context_length' };
  }

  return { taskType: 'general_chat', confidence: 0.65, reason: 'general_chat_default' };
}

function modelIdFrom(value) {
  if (typeof value === 'string') return asString(value);
  return asString(value?.modelId || value?.id || value?.model);
}

function providerIdFrom(value) {
  if (typeof value === 'string') return '';
  return normalizeProviderId(value?.providerId || value?.provider || '');
}

function normalizeModelRecord(value, fallbackProvider = '') {
  const id = modelIdFrom(value);
  if (!id) return null;
  const meta = value && typeof value === 'object' && value.meta && typeof value.meta === 'object'
    ? value.meta
    : {};
  return {
    id,
    providerId: providerIdFrom(value) || normalizeProviderId(fallbackProvider),
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : true,
    capabilities: normalizeCapabilities(value?.capabilities || meta.capabilities),
    contextWindow: Number(
      value?.contextWindow ??
      value?.maxContextTokens ??
      meta.contextWindow ??
      meta.maxContextTokens ??
      0
    ) || 0
  };
}

function mergeProviderRow(map, value, fallbackId = '') {
  const id = normalizeProviderId(
    typeof value === 'string'
      ? value
      : value?.providerId || value?.id || fallbackId
  );
  if (!id || id === 'auto') return;
  const existing = map.get(id) || {
    id,
    configured: undefined,
    enabled: undefined,
    capabilities: {},
    models: []
  };
  const models = Array.isArray(value?.models) ? value.models : [];
  map.set(id, {
    ...existing,
    configured: typeof value?.configured === 'boolean' ? value.configured : existing.configured,
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : existing.enabled,
    capabilities: {
      ...existing.capabilities,
      ...normalizeCapabilities(value?.capabilities)
    },
    models: [...existing.models, ...models]
  });
}

function collectProviderRows({ availableProviders, providerCapabilities } = {}, providerManager, config) {
  const rows = new Map();
  let managerRows = [];
  try {
    managerRows = providerManager?.listProviders?.() || [];
  } catch {
    managerRows = [];
  }
  for (const row of managerRows) mergeProviderRow(rows, row);

  if (Array.isArray(availableProviders)) {
    for (const row of availableProviders) mergeProviderRow(rows, row);
  } else if (availableProviders && typeof availableProviders === 'object') {
    for (const [providerId, row] of Object.entries(availableProviders)) {
      mergeProviderRow(rows, row, providerId);
    }
  }

  for (const [providerId, models] of Object.entries(config?.providerModels || {})) {
    mergeProviderRow(rows, { id: providerId, models });
  }

  if (providerCapabilities && typeof providerCapabilities === 'object') {
    for (const [providerId, capabilities] of Object.entries(providerCapabilities)) {
      mergeProviderRow(rows, { id: providerId, capabilities });
    }
  }

  for (const [providerId, row] of rows) {
    let configured = row.configured;
    let enabled = row.enabled;
    let capabilities = row.capabilities;
    try {
      if (configured === undefined && typeof providerManager?.isConfigured === 'function') {
        configured = Boolean(providerManager.isConfigured(providerId));
      }
      if (enabled === undefined && typeof providerManager?.isEnabled === 'function') {
        enabled = Boolean(providerManager.isEnabled(providerId));
      }
      if (Object.keys(capabilities).length === 0 && typeof providerManager?.getProviderCapabilities === 'function') {
        capabilities = normalizeCapabilities(providerManager.getProviderCapabilities(providerId));
      }
    } catch {
      // An unavailable manager must not make routing fatal.
    }
    rows.set(providerId, {
      ...row,
      configured: configured !== false,
      enabled: enabled !== false,
      capabilities
    });
  }
  return rows;
}

function addModelRecord(modelMap, record) {
  if (!record?.id || !record.providerId || record.providerId === 'auto') return;
  const providerModels = modelMap.get(record.providerId) || new Map();
  const existing = providerModels.get(record.id);
  providerModels.set(record.id, existing
    ? {
        ...existing,
        ...record,
        enabled: existing.enabled !== false && record.enabled !== false,
        contextWindow: record.contextWindow || existing.contextWindow || 0,
        capabilities: { ...existing.capabilities, ...record.capabilities }
      }
    : record);
  modelMap.set(record.providerId, providerModels);
}

function collectModelRows(input = {}, providerRows, providerManager, config, db) {
  const modelMap = new Map();
  for (const [providerId, row] of providerRows) {
    let models = row.models || [];
    try {
      const managerModels = providerManager?.getProviderModels?.(providerId);
      if (Array.isArray(managerModels)) models = [...models, ...managerModels];
    } catch {
      // Keep the provider row's configured models.
    }
    for (const model of models) {
      addModelRecord(modelMap, normalizeModelRecord(model, providerId));
    }
  }

  const availableModels = input.availableModels;
  if (Array.isArray(availableModels)) {
    for (const model of availableModels) {
      const record = normalizeModelRecord(model);
      if (record?.providerId) addModelRecord(modelMap, record);
    }
  } else if (availableModels && typeof availableModels === 'object') {
    for (const [providerId, models] of Object.entries(availableModels)) {
      for (const model of Array.isArray(models) ? models : []) {
        addModelRecord(modelMap, normalizeModelRecord(model, providerId));
      }
    }
  }

  for (const [providerId, models] of Object.entries(config?.providerModels || {})) {
    for (const model of models || []) {
      addModelRecord(modelMap, normalizeModelRecord(model, providerId));
    }
  }

  // Existing model metadata can refine an environment-configured model, but it
  // cannot introduce a model that was never configured for runtime use.
  try {
    for (const stored of db?.listModelConfigs?.() || []) {
      const providerId = normalizeProviderId(stored.providerId);
      const modelId = modelIdFrom(stored);
      const existing = modelMap.get(providerId)?.get(modelId);
      if (!existing) continue;
      addModelRecord(modelMap, normalizeModelRecord(stored, providerId));
    }
  } catch {
    // Routing must remain available when optional admin metadata is unavailable.
  }
  return modelMap;
}

function modelSupports(record, providerCapabilities, capability) {
  if (!capability) return true;
  if (Object.hasOwn(record?.capabilities || {}, capability)) {
    return Boolean(record.capabilities[capability]);
  }
  return Boolean(providerCapabilities?.[capability]);
}

function requiredCapabilityFor(taskType, requestedCapability = '', input = {}) {
  const explicit = asString(requestedCapability);
  const hasRetrievedContext = Boolean(input.conversationContext?.hasRetrievedContext);
  if (
    ['web_research', 'tool_calling'].includes(taskType) &&
    input.allowToolCalls === true &&
    !hasRetrievedContext
  ) {
    return 'toolCalls';
  }
  if (explicit) return explicit;
  return TASK_CAPABILITIES[taskType] || 'chat';
}

function modeTargetFromInput(modeSelection = {}) {
  if (!modeSelection || typeof modeSelection !== 'object') return { provider: '', model: '' };
  return {
    provider: normalizeProviderId(modeSelection.provider || modeSelection.providerId),
    model: asString(modeSelection.model || modeSelection.modelId)
  };
}

function configuredTaskTarget(config, routeKey) {
  const configuredProvider = normalizeProviderId(config?.smartRoutingProviders?.[routeKey]);
  const configuredModel = asString(config?.smartRoutingModels?.[routeKey]);
  const defaultProvider = normalizeProviderId(config?.defaultAIProvider || config?.aiProvider);

  if (!configuredProvider && configuredModel && defaultProvider === 'auto') {
    // Under an automatic default, a model without an owning provider is
    // ambiguous and must not be guessed from provider iteration order.
    return { provider: '', model: '' };
  }

  return {
    provider:
      configuredProvider ||
      (configuredModel && defaultProvider && defaultProvider !== 'auto' ? defaultProvider : ''),
    model: configuredModel
  };
}

function taskTarget(config, taskType, requiredCapability = '') {
  const specializedCapability = TASK_CAPABILITIES[taskType] || '';
  if (
    specializedCapability &&
    specializedCapability !== 'toolCalls' &&
    requiredCapability !== specializedCapability
  ) {
    // A text completion that merely mentions image/audio generation must not
    // be sent to a media model. Dedicated feature handlers execute those
    // capabilities and can request their specialized route explicitly.
    return configuredTaskTarget(config, 'general');
  }

  if (taskType === 'image_generation') {
    return {
      provider: normalizeProviderId(config?.imageProvider),
      model: asString(config?.imageModel)
    };
  }
  if (taskType === 'speech_to_text') {
    return {
      provider: normalizeProviderId(config?.transcriptionProvider),
      model: asString(config?.transcriptionModel)
    };
  }
  if (taskType === 'text_to_speech') {
    return {
      provider: normalizeProviderId(config?.ttsProvider),
      model: asString(config?.ttsModel)
    };
  }
  if (taskType === 'live_voice') {
    return {
      provider: 'gemini-live',
      model: asString(config?.geminiLiveModel)
    };
  }
  const routeKey = ROUTE_KEY_BY_TASK[taskType] || 'general';
  return configuredTaskTarget(config, routeKey);
}

function defaultTarget(config = {}) {
  return {
    provider: normalizeProviderId(config.defaultAIProvider || config.aiProvider),
    model: asString(config.defaultModel)
  };
}

function candidateProviders(providerRows, modelMap, requestedProvider, requestedModel) {
  const provider = normalizeProviderId(requestedProvider);
  if (provider && provider !== 'auto') return [provider];
  if (requestedModel) {
    return [...modelMap.entries()]
      .filter(([, models]) => models.has(requestedModel))
      .map(([providerId]) => providerId);
  }
  return [...providerRows.keys()];
}

function routeResult({
  task,
  candidate,
  source,
  reason,
  fallbackModels = []
}) {
  return {
    taskType: task.taskType,
    provider: candidate?.providerId || '',
    model: candidate?.modelId || '',
    confidence: task.confidence,
    reason: reason || task.reason,
    fallbackModels,
    source
  };
}

export class AIModelRouter {
  constructor({ config = {}, providerManager = null, db = null, logger = console } = {}) {
    this.config = config;
    this.providerManager = providerManager;
    this.db = db;
    this.logger = logger || console;
    this.policyVersion = SMART_ROUTER_POLICY_VERSION;
    this.version = SMART_ROUTER_POLICY_VERSION;
  }

  emit(event, route, input = {}, extra = {}) {
    const meta = {
      taskType: normalizeTaskType(route?.taskType) || 'general_chat',
      provider: asString(route?.provider),
      model: asString(route?.model),
      confidence: clampConfidence(route?.confidence, 0),
      reason: asString(route?.reason),
      source: asString(route?.source),
      userId: asString(input.userId),
      chatId: asString(input.chatId),
      textLength: asString(input.text).length,
      attachmentType: asString(input.attachmentType),
      policyVersion: SMART_ROUTER_POLICY_VERSION,
      ...extra
    };
    const alwaysLog = event === 'smart_router_capability_rejected' || event === 'smart_router_no_candidate';
    if (!alwaysLog && !this.config.smartRoutingDebug) return;
    const level = alwaysLog ? 'warn' : 'info';
    this.logger?.[level]?.(event, meta);
  }

  selectCandidate({
    providerRows,
    modelMap,
    provider = '',
    model = '',
    taskType,
    requiredCapability,
    estimatedTokens = 0,
    input
  }) {
    const requestedModel = asString(model);
    for (const providerId of candidateProviders(providerRows, modelMap, provider, requestedModel)) {
      const row = providerRows.get(providerId);
      if (!row || !row.configured || !row.enabled) continue;
      if (
        providerId === 'gemini-live' &&
        !['live_voice', 'speech_to_text', 'text_to_speech'].includes(taskType)
      ) {
        continue;
      }
      const providerModels = modelMap.get(providerId) || new Map();
      const models = requestedModel
        ? [providerModels.get(requestedModel)].filter(Boolean)
        : [...providerModels.values()];
      for (const record of models) {
        if (!record?.enabled) continue;
        if (!modelSupports(record, row.capabilities, requiredCapability)) {
          this.emit(
            'smart_router_capability_rejected',
            {
              taskType,
              provider: providerId,
              model: record.id,
              confidence: 0,
              reason: `requires_${requiredCapability}`,
              source: 'capability_check'
            },
            input,
            { requiredCapability }
          );
          continue;
        }
        if (record.contextWindow > 0 && estimatedTokens > record.contextWindow) {
          this.emit(
            'smart_router_capability_rejected',
            {
              taskType,
              provider: providerId,
              model: record.id,
              confidence: 0,
              reason: 'context_window_too_small',
              source: 'capability_check'
            },
            input,
            { requiredCapability: 'contextWindow' }
          );
          continue;
        }
        return { providerId, modelId: record.id };
      }
    }
    return null;
  }

  route(input = {}) {
    const safeInput = input && typeof input === 'object' ? input : {};
    const task = classifyTask(safeInput);
    const minimumConfidence = clampConfidence(this.config.smartRoutingMinConfidence, 0.55);
    const providerRows = collectProviderRows(
      safeInput,
      this.providerManager,
      this.config
    );
    const modelMap = collectModelRows(
      safeInput,
      providerRows,
      this.providerManager,
      this.config,
      this.db
    );
    const requiredCapability = requiredCapabilityFor(
      task.taskType,
      safeInput.requiredCapability,
      safeInput
    );
    const estimatedTokens = Math.ceil(
      Math.max(asString(safeInput.text).length, textLengthFromContext(safeInput.conversationContext)) / 4
    );
    const settings = safeInput.userSettings || safeInput.settings || {};
    const rawProvider = normalizeProviderId(
      settings.rawProviderId ?? settings.providerId ?? settings.provider
    );
    const rawModel = asString(settings.rawModelId ?? settings.modelId ?? settings.model);
    const manualProvider = typeof settings.manualProvider === 'boolean'
      ? settings.manualProvider
      : Boolean(rawProvider && rawProvider !== 'auto');
    const manualModel = typeof settings.manualModel === 'boolean'
      ? settings.manualModel
      : Boolean(rawModel && settings.autoRouting !== true);

    if (manualModel || manualProvider) {
      const effectiveModel = asString(settings.modelId || settings.model || rawModel);
      let effectiveProvider = manualProvider
        ? rawProvider
        : normalizeProviderId(settings.providerId || settings.provider || rawProvider);

      if (manualModel && (!effectiveProvider || effectiveProvider === 'auto')) {
        const owningProviders = candidateProviders(
          providerRows,
          modelMap,
          '',
          effectiveModel
        );
        effectiveProvider =
          owningProviders.find((providerId) => {
            const row = providerRows.get(providerId);
            return row?.configured && row?.enabled;
          }) ||
          owningProviders[0] ||
          effectiveProvider;
      }

      const model =
        effectiveModel ||
        [...(modelMap.get(effectiveProvider)?.keys() || [])][0] ||
        '';
      const candidate = {
        providerId: effectiveProvider,
        modelId: model
      };
      const fallbackModels = [...(modelMap.get(effectiveProvider)?.keys() || [])]
        .filter((modelId) => modelId !== model);
      const result = routeResult({
        task,
        candidate,
        source: manualModel ? 'manual_model' : 'manual_provider',
        reason: manualModel ? 'manual_model_override' : 'manual_provider_override',
        fallbackModels
      });
      this.emit('smart_router_manual_override', result, safeInput);
      return result;
    }

    const modeSelection = modeTargetFromInput(safeInput.modeSelection);
    if (modeSelection.provider || modeSelection.model) {
      let modeProvider = modeSelection.provider;
      if (!modeProvider && modeSelection.model) {
        const owners = candidateProviders(providerRows, modelMap, '', modeSelection.model);
        modeProvider =
          owners.find((providerId) => {
            const row = providerRows.get(providerId);
            return row?.configured && row?.enabled;
          }) ||
          owners[0] ||
          '';
      }
      const modeModel =
        modeSelection.model ||
        [...(modelMap.get(modeProvider)?.keys() || [])][0] ||
        '';
      const candidate = {
        providerId: modeProvider,
        modelId: modeModel
      };
      const result = routeResult({
        task,
        candidate,
        source: 'mode',
        reason: 'mode_target',
        fallbackModels: [...(modelMap.get(modeProvider)?.keys() || [])]
          .filter((modelId) => modelId !== modeModel)
      });
      this.emit('smart_router_selected', result, safeInput);
      return result;
    }

    if (this.config.smartRoutingEnabled !== false && task.confidence >= minimumConfidence) {
      const target = taskTarget(this.config, task.taskType, requiredCapability);
      if (target.provider || target.model) {
        const candidate = this.selectCandidate({
          providerRows,
          modelMap,
          ...target,
          taskType: task.taskType,
          requiredCapability,
          estimatedTokens,
          input: safeInput
        }) || (
          target.provider
            ? this.selectCandidate({
                providerRows,
                modelMap,
                provider: target.provider,
                taskType: task.taskType,
                requiredCapability,
                estimatedTokens,
                input: safeInput
              })
            : null
        );
        if (candidate) {
          const fallbackModels = [...(modelMap.get(candidate.providerId)?.keys() || [])]
            .filter((model) => model !== candidate.modelId);
          const result = routeResult({
            task,
            candidate,
            source: 'smart',
            fallbackModels
          });
          this.emit('smart_router_selected', result, safeInput);
          return result;
        }
      }
    }

    const fallback = defaultTarget(this.config);
    if (fallback.provider || fallback.model) {
      const candidate = {
        providerId: fallback.provider,
        modelId: fallback.model
      };
      const fallbackModels = [...(modelMap.get(candidate.providerId)?.keys() || [])]
        .filter((model) => model !== candidate.modelId);
      const result = routeResult({
        task,
        candidate,
        source: 'default',
        reason: this.config.smartRoutingEnabled === false
          ? 'smart_routing_disabled'
          : task.confidence < minimumConfidence
            ? 'below_minimum_confidence'
            : 'no_configured_task_target',
        fallbackModels
      });
      this.emit('smart_router_default_fallback', result, safeInput);
      return result;
    }

    const result = routeResult({
      task,
      candidate: null,
      source: 'none',
      reason: 'no_usable_candidate'
    });
    this.emit('smart_router_no_candidate', result, safeInput, { requiredCapability });
    return result;
  }
}

export function createAIModelRouter(options = {}) {
  return new AIModelRouter(options);
}

export default AIModelRouter;
