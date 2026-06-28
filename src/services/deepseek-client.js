import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class DeepSeekClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'deepseek',
      apiKey: config.deepseekApiKey,
      baseUrl: config.deepseekBaseUrl,
      headers: config.deepseekApiVersion ? { 'x-api-version': config.deepseekApiVersion } : {},
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
