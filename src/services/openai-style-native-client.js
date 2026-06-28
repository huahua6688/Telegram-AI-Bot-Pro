import { OpenAICompatibleClient } from './openai-compatible-client.js';
import { UnsupportedClientFeatureError } from './unsupported-client-feature-error.js';
import { truncateText } from '../utils/text.js';

export class OpenAIStyleNativeClient extends OpenAICompatibleClient {
  constructor(config, logger, options) {
    super(config, logger);
    this.providerName = options.providerName;
    this.nativeBaseUrl = options.baseUrl.replace(/\/$/, '');
    this.nativeApiKey = options.apiKey;
    this.nativeHeaders = options.headers || {};
    this.capabilities = options.capabilities || {
      chat: true,
      toolCalls: true,
      vision: true,
      imageGeneration: false,
      speechSynthesis: false,
      speechTranscription: false
    };
  }

  getProviderName() {
    return this.providerName;
  }

  getCapabilities() {
    return this.capabilities;
  }

  async request(endpoint, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(`${this.nativeBaseUrl}${endpoint}`, {
        ...options,
        headers: {
          Authorization: 'Bearer ' + this.nativeApiKey,
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...this.nativeHeaders,
          ...(options.headers || {})
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI request failed (${response.status}): ${truncateText(body, 600)}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json();
      }
      return response.arrayBuffer();
    } finally {
      clearTimeout(timeout);
    }
  }

  async transcribeAudio(args) {
    if (!this.capabilities.speechTranscription) {
      throw new UnsupportedClientFeatureError(this.providerName, '语音转文字');
    }
    return super.transcribeAudio(args);
  }

  async generateSpeech(args) {
    if (!this.capabilities.speechSynthesis) {
      throw new UnsupportedClientFeatureError(this.providerName, '文字转语音');
    }
    return super.generateSpeech(args);
  }

  async generateImage(args) {
    if (!this.capabilities.imageGeneration) {
      throw new UnsupportedClientFeatureError(this.providerName, '图片生成');
    }
    return super.generateImage(args);
  }
}
