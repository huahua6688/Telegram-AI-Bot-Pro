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
  assert.equal(capabilities.vision, true);
  assert.equal(capabilities.imageGeneration, false);
  assert.equal(capabilities.liveAudio, false);
  assert.equal(capabilities.liveTranslate, false);
});

test('createAIClient creates gemini-live provider client via registry', () => {
  const client = createAIClient(
    {
      aiProvider: 'gemini-live',
      geminiLiveApiKey: 'gemini-live-key',
      geminiLiveBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      requestTimeoutMs: 1000,
      temperature: 0.6,
      aiMaxToolSteps: 1,
      geminiLiveTranscriptionModel: 'gemini-2.5-flash-preview-native-audio-dialog',
      geminiLiveTtsModel: 'gemini-2.5-flash-preview-native-audio-dialog',
      ttsModel: 'x',
      ttsVoice: 'x',
      transcriptionModel: 'x',
      imageModel: 'x',
      imageSize: '1024x1024'
    },
    logger
  );

  assert.equal(client.getProviderName(), 'gemini-live');
  const capabilities = client.getCapabilities();
  assert.equal(capabilities.chat, true);
  assert.equal(capabilities.toolCalls, false);
  assert.equal(capabilities.speechTranscription, true);
  assert.equal(capabilities.speechSynthesis, true);
  assert.equal(capabilities.liveAudio, true);
  assert.equal(capabilities.nativeAudio, true);
});

test('createAIClient creates OpenAI-compatible platform provider clients via registry', () => {
  const cases = [
    {
      provider: 'groq',
      config: {
        groqApiKey: 'groq-key',
        groqBaseUrl: 'https://api.groq.com/openai/v1'
      }
    },
    {
      provider: 'openrouter',
      config: {
        openrouterApiKey: 'openrouter-key',
        openrouterBaseUrl: 'https://openrouter.ai/api/v1',
        openrouterAppTitle: 'Telegram AI Bot Pro'
      }
    },
    {
      provider: 'github-models',
      config: {
        githubModelsApiKey: 'github-key',
        githubModelsBaseUrl: 'https://models.github.ai/inference'
      }
    },
    {
      provider: 'huggingface',
      config: {
        huggingfaceApiKey: 'hf-key',
        huggingfaceBaseUrl: 'https://router.huggingface.co/v1'
      }
    },
    {
      provider: 'mistral',
      config: {
        mistralApiKey: 'mistral-key',
        mistralBaseUrl: 'https://api.mistral.ai/v1'
      }
    },
    {
      provider: 'openai',
      config: {
        openaiApiKey: 'openai-key',
        openaiBaseUrl: 'https://api.openai.com/v1'
      }
    }
  ];

  for (const item of cases) {
    const client = createAIClient(
      {
        aiProvider: item.provider,
        requestTimeoutMs: 1000,
        temperature: 0.6,
        aiMaxToolSteps: 1,
        ttsModel: 'x',
        ttsVoice: 'x',
        transcriptionModel: 'x',
        imageModel: 'x',
        imageSize: '1024x1024',
        ...item.config
      },
      logger
    );
    assert.equal(client.getProviderName(), item.provider);
    assert.equal(client.getCapabilities().chat, true);
  }
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
