import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class GLMClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'glm',
      apiKey: config.glmApiKey,
      baseUrl: config.glmBaseUrl,
      headers: config.glmApiVersion ? { 'x-api-version': config.glmApiVersion } : {},
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
