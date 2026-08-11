import test from 'node:test';
import assert from 'node:assert/strict';
import { inferModelProfile, normalizeDiscoveredModels } from '../src/services/ai-model-catalog.js';
import { AIProviderManager } from '../src/services/ai-provider-manager.js';

test('model catalog preserves provider descriptions and filters non-chat models', () => {
  const rows = normalizeDiscoveredModels({ data: [
    { id: 'acme-vision', description: 'Official multimodal model', context_length: 128000 },
    { id: 'text-embedding-3-small' },
    { id: 'code-reasoner' }
  ] });
  assert.equal(rows[0].descriptionSource === 'provider' || rows[1].descriptionSource === 'provider', true);
  assert.equal(rows.find((row) => row.id === 'text-embedding-3-small').chatCompatible, false);
  assert.ok(rows.find((row) => row.id === 'code-reasoner').capabilities.includes('coding'));
  assert.ok(inferModelProfile({ id: 'acme-vision' }).capabilities.includes('vision'));
});

test('provider manager discovers OpenAI-compatible models without configured model names', async () => {
  const config = {
    aiProvider: 'openai-compatible', aiApiKey: 'test-key', aiBaseUrl: 'https://example.test/v1',
    defaultModel: '', availableModels: [], providerModels: { 'openai-compatible': [] }, providerDefaultModels: {},
    imageProvider: 'gemini', ttsProvider: 'gemini-live', transcriptionProvider: 'gemini-live', visionProvider: 'gemini',
    modelListCacheTtlMs: 3600000, requestTimeoutMs: 1000
  };
  const manager = new AIProviderManager({
    config,
    logger: { info() {}, warn() {} },
    clientFactory: () => ({
      listModels: async () => ({ data: [
        { id: 'hub-chat', description: 'Hub chat model' },
        { id: 'hub-embedding' },
        { id: 'hub-image-generation' },
        { id: 'hub-tts' },
        { id: 'hub-whisper' }
      ] })
    })
  });
  const result = await manager.refreshModels('openai-compatible', { force: true });
  assert.equal(result.count, 5);
  assert.deepEqual(manager.getProviderModels('openai-compatible'), ['hub-chat']);
  assert.deepEqual(manager.getModelsForCapability('openai-compatible', 'imageGeneration'), ['hub-image-generation']);
  assert.equal(config.imageProvider, 'openai-compatible');
  assert.equal(config.imageModel, 'hub-image-generation');
  assert.equal(config.ttsModel, 'hub-tts');
  assert.equal(config.transcriptionModel, 'hub-whisper');
  assert.equal(config.defaultModel, 'hub-chat');
  assert.equal((await manager.refreshModels('openai-compatible')).cached, true);
});
