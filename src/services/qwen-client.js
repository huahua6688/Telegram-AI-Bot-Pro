import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class QwenClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'qwen',
      apiKey: config.qwenApiKey,
      baseUrl: config.qwenBaseUrl,
      headers: config.qwenApiVersion ? { 'x-api-version': config.qwenApiVersion } : {},
      capabilities: {
        chat: true,
        toolCalls: true,
        vision: true,
        imageGeneration: false,
        speechSynthesis: false,
        speechTranscription: false
      }
    });
  }
}
