import { createAIClient } from '../../services/ai-client-factory.js';

class UnavailableAIClient {
  constructor(error, provider = 'unconfigured') {
    this.error = error;
    this.provider = provider;
  }

  getProviderName() {
    return this.provider;
  }

  getCapabilities() {
    return {
      chat: false,
      streaming: false,
      toolCalls: false,
      vision: false,
      imageGeneration: false,
      imageEditing: false,
      speechSynthesis: false,
      speechTranscription: false,
      liveAudio: false,
      liveTranslate: false,
      nativeAudio: false
    };
  }

  async completeWithTools() {
    throw this.error || new Error('No AI provider is configured.');
  }

  async generateImage() {
    throw this.error || new Error('No image provider is configured.');
  }

  async transcribeAudio() {
    throw this.error || new Error('No transcription provider is configured.');
  }

  async generateSpeech() {
    throw this.error || new Error('No TTS provider is configured.');
  }
}

export function createAIProviderClient(config, logger) {
  try {
    return createAIClient(config, logger);
  } catch (error) {
    logger?.warn?.('Default AI provider is not available at startup', {
      provider: config.aiProvider,
      error: error.message
    });
    return new UnavailableAIClient(error, config.aiProvider || 'unconfigured');
  }
}
