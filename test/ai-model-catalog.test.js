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
  assert.equal(inferModelProfile({ id: 'vendor/chat:free' }).pricingTier, 'free');
  assert.equal(inferModelProfile({ id: 'paid-chat', pricing: { prompt: '0.1', completion: '0.2' } }).pricingTier, 'paid');
  assert.equal(inferModelProfile({ id: 'claude-example' }).descriptionSource, 'catalog');
  assert.equal(
    inferModelProfile({ id: 'general-chat', description: 'Chat model that can discuss embeddings' }).chatCompatible,
    true,
    'provider prose must not reclassify a chat model as an embedding endpoint'
  );
});

test('provider manager discovers models but requires selection when platform pricing is unknown', async () => {
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
  assert.equal(config.defaultModel, '');
  assert.equal(config.modelSelectionRequired, true);
  assert.deepEqual(manager.getCandidateModels('openai-compatible', 'hub-chat'), ['hub-chat']);
  assert.equal((await manager.refreshModels('openai-compatible')).cached, true);
});

test('provider manager automatically chooses a model only when the platform identifies it as free', async () => {
  const config = {
    aiProvider: 'openai-compatible', aiApiKey: 'test-key', defaultModel: '', defaultModelExplicit: false,
    availableModels: [], providerModels: { 'openai-compatible': [] }, providerDefaultModels: {},
    modelListCacheTtlMs: 0, requestTimeoutMs: 1000
  };
  const manager = new AIProviderManager({
    config,
    logger: { info() {}, warn() {} },
    clientFactory: () => ({
      listModels: async () => ({ data: [
        { id: 'paid-chat', pricing: { prompt: 0.1 } },
        { id: 'free-chat', pricing: { prompt: 0, completion: 0 } }
      ] })
    })
  });
  await manager.refreshModels('openai-compatible', { force: true });
  assert.equal(config.defaultModel, 'free-chat');
  assert.equal(config.modelSelectionRequired, false);
  assert.deepEqual(manager.getCandidateModels('openai-compatible'), ['free-chat', 'paid-chat']);
});

test('automatic cross-provider mode can use discovered paid fallback models without promoting one to default', async () => {
  const config = {
    aiProvider: 'auto', aiApiKey: 'paid-fallback-key', defaultModel: '', defaultModelExplicit: false,
    availableModels: [], providerModels: { 'openai-compatible': [] }, providerDefaultModels: {},
    modelListCacheTtlMs: 0, requestTimeoutMs: 1000
  };
  const manager = new AIProviderManager({
    config,
    logger: { info() {}, warn() {} },
    clientFactory: () => ({
      listModels: async () => ({ data: [
        { id: 'hub-paid-chat', description: 'Paid fallback chat model' }
      ] })
    })
  });

  await manager.refreshModels('openai-compatible', { force: true });
  assert.equal(config.defaultModel, '');
  assert.equal(config.modelSelectionRequired, undefined);
  assert.deepEqual(manager.getCandidateModels('openai-compatible'), ['hub-paid-chat']);
});
