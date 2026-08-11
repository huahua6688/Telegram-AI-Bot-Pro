const TYPE_PATTERNS = Object.freeze({
  embedding: /(?:embedding|\bembed\b|text-embedding)/i,
  rerank: /(?:rerank|re-rank|ranking-model)/i,
  speechSynthesis: /(?:\btts\b|text[-_ ]to[-_ ]speech|speech[-_ ]synth)/i,
  speechTranscription: /(?:whisper|transcri|speech[-_ ]to[-_ ]text|\bstt\b)/i,
  imageGeneration: /(?:dall-e|gpt-image|imagen|flux|stable[-_ ]diffusion|image[-_ ]generation|text[-_ ]to[-_ ]image)/i,
  videoGeneration: /(?:video[-_ ]generation|text[-_ ]to[-_ ]video|sora|veo|kling|wan[-_ ]?video)/i,
  moderation: /(?:moderation|content[-_ ]safety)/i
});

function text(value = '') {
  return String(value ?? '').trim();
}

function first(...values) {
  return values.map(text).find(Boolean) || '';
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
  const contextWindow = Number(raw.context_length || raw.context_window || raw.max_context_length || 0) || null;
  return {
    id,
    ownedBy: first(raw.owned_by, raw.provider, raw.vendor),
    description: officialDescription || uses.join('；'),
    descriptionSource: officialDescription ? 'provider' : 'inferred',
    capabilities: [...capabilities],
    recommendedUses: uses,
    contextWindow,
    endpointType: specializedType || 'chat',
    chatCompatible: !specializedType,
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
