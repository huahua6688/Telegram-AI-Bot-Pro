import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class GrokClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'grok',
      apiKey: config.grokApiKey,
      baseUrl: config.grokBaseUrl,
      headers: config.grokApiVersion ? { 'x-api-version': config.grokApiVersion } : {},
      capabilities: {
        chat: true,
        toolCalls: true,
        imageGeneration: false,
        speechSynthesis: false,
        speechTranscription: false
      }
    });
  }
}
