import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIClient } from '../src/services/ai-client-factory.js';

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

test('createAIClient creates first-batch native provider clients via registry', () => {
  const client = createAIClient(
    {
      aiProvider: 'qwen',
      qwenApiKey: 'qwen-key',
      qwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      requestTimeoutMs: 1000,
      temperature: 0.6,
      aiMaxToolSteps: 1,
      ttsModel: 'x',
      ttsVoice: 'x',
      transcriptionModel: 'x',
      imageModel: 'x',
      imageSize: '1024x1024'
    },
    logger
  );

  assert.equal(client.getProviderName(), 'qwen');
  const capabilities = client.getCapabilities();
  assert.equal(capabilities.chat, true);
  assert.equal(capabilities.toolCalls, true);
  assert.equal(capabilities.imageGeneration, false);
});

test('createAIClient throws for unknown provider', () => {
  assert.throws(
    () =>
      createAIClient(
        {
          aiProvider: 'unknown-provider',
          aiApiKey: 'x'
        },
        logger
      ),
    /Unsupported AI_PROVIDER/
  );
});
