const TYPE_PATTERNS = Object.freeze({
  embedding: /(?:embedding|\bembed\b|text-embedding)/i,
  rerank: /(?:rerank|re-rank|ranking-model)/i,
  speechSynthesis: /(?:\btts\b|text[-_ ]to[-_ ]speech|speech[-_ ]synth)/i,
  speechTranscription: /(?:whisper|transcri|speech[-_ ]to[-_ ]text|\bstt\b)/i,
  imageGeneration: /(?:dall-e|gpt-image|imagen|flux|stable[-_ ]diffusion|image[-_ ]generation|text[-_ ]to[-_ ]image)/i,
  videoGeneration: /(?:video[-_ ]generation|text[-_ ]to[-_ ]video|sora|veo|kling|wan[-_ ]?video)/i,
  moderation: /(?:moderation|content[-_ ]safety)/i
});

const KNOWN_MODEL_FAMILIES = Object.freeze([
  { pattern: /claude/i, description: '通用对话、写作、推理、代码与长文本分析' },
  { pattern: /gemini/i, description: '通用对话、多模态理解、工具调用与长上下文任务' },
  { pattern: /(?:gpt|o[134](?:-|$))/i, description: '通用对话、推理、代码、写作与工具调用' },
  { pattern: /deepseek.*(?:r1|reason)/i, description: '复杂推理、数学、规划与代码分析' },
  { pattern: /(?:coder|codestral|devstral)/i, description: '代码生成、调试、重构与代码审查' },
  { pattern: /(?:llama|mistral|qwen)/i, description: '通用对话、写作、翻译、摘要与代码任务' }
]);

function text(value = '') {
  return String(value ?? '').trim();
}

function first(...values) {
  return values.map(text).find(Boolean) || '';
}

function readPricing(raw = {}) {
  const pricing = raw.pricing || raw.price || {};
  const values = [pricing.prompt, pricing.completion, pricing.input, pricing.output]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map(Number);
  if (values.length && values.every((value) => Number.isFinite(value) && value === 0)) return { tier: 'free', source: 'provider' };
  if (values.some((value) => Number.isFinite(value) && value > 0)) return { tier: 'paid', source: 'provider' };
  const id = first(raw.id, raw.model, raw.name);
  if (/(?:^|[/:_-])free(?:$|[/:_-])/i.test(id)) return { tier: 'free', source: 'model-id' };
  return { tier: 'unknown', source: '' };
}

export function inferModelProfile(raw = {}) {
  const id = first(raw.id, raw.model, raw.name);
  const haystack = `${id} ${raw.description || ''}`.toLowerCase();
  const specializedType = Object.entries(TYPE_PATTERNS).find(([, pattern]) => pattern.test(haystack))?.[0] || '';
  const capabilities = new Set(specializedType ? [] : ['chat']);
  const uses = [];

  if (specializedType) capabilities.add(specializedType);
  const specializedUses = {
    embedding: '知识库、语义检索与长期记忆',
    rerank: '搜索结果与知识库结果重排',
    speechSynthesis: '文字转语音（TTS）',
    speechTranscription: '语音转文字',
    imageGeneration: '图片生成与编辑',
    videoGeneration: '视频生成',
    moderation: '内容安全审核'
  };
  if (specializedType) uses.push(specializedUses[specializedType]);

  if (!specializedType && /(?:vision|\bvl\b|multimodal|gpt-4o|gpt-4\.1|gemini|claude)/i.test(haystack)) capabilities.add('vision');
  if (!specializedType && /(?:tool|function|gpt|claude|gemini|qwen|llama|mistral|deepseek)/i.test(haystack)) capabilities.add('toolCalls');
  if (/(?:reason|thinking|o1|o3|o4|deepseek-r1|qwq)/i.test(haystack)) {
    capabilities.add('reasoning');
    uses.push('复杂推理、数学与规划');
  }
  if (/(?:code|coder|codestral|devstral)/i.test(haystack)) {
    capabilities.add('coding');
    uses.push('编程、调试与代码审查');
  }
  if (capabilities.has('vision')) uses.push('图片理解与 OCR');
  if (capabilities.has('toolCalls')) uses.push('联网搜索与工具调用');
  if (!uses.length) uses.push('日常聊天、写作与翻译');

  const officialDescription = first(raw.description, raw.summary, raw.details?.description);
  const catalogDescription = KNOWN_MODEL_FAMILIES.find((item) => item.pattern.test(id))?.description || '';
  const pricing = readPricing(raw);
  const contextWindow = Number(raw.context_length || raw.context_window || raw.max_context_length || 0) || null;
  return {
    id,
    ownedBy: first(raw.owned_by, raw.provider, raw.vendor),
    description: officialDescription || catalogDescription || uses.join('；'),
    descriptionSource: officialDescription ? 'provider' : catalogDescription ? 'catalog' : 'inferred',
    capabilities: [...capabilities],
    recommendedUses: uses,
    contextWindow,
    endpointType: specializedType || 'chat',
    chatCompatible: !specializedType,
    pricingTier: pricing.tier,
    pricingSource: pricing.source,
    raw
  };
}

export function normalizeDiscoveredModels(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set();
  return rows
    .map((row) => inferModelProfile(typeof row === 'string' ? { id: row } : row))
    .filter((row) => row.id && !seen.has(row.id) && seen.add(row.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function formatModelProfile(profile, locale = 'zh') {
  const inferred = profile.descriptionSource === 'inferred';
  const capabilityText = profile.capabilities.join(', ') || profile.endpointType;
  if (String(locale).toLowerCase().startsWith('en')) {
    return `${profile.id}\n  Type: ${capabilityText}\n  ${profile.description}${inferred ? ' (inferred from model name)' : ''}${profile.contextWindow ? `\n  Context: ${profile.contextWindow.toLocaleString()} tokens` : ''}`;
  }
  return `${profile.id}\n  类型：${capabilityText}\n  ${profile.description}${inferred ? '（根据模型名称推测）' : ''}${profile.contextWindow ? `\n  上下文：${profile.contextWindow.toLocaleString()} tokens` : ''}`;
}
