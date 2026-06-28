import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class DoubaoClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'doubao',
      apiKey: config.doubaoApiKey,
      baseUrl: config.doubaoBaseUrl,
      headers: config.doubaoApiVersion ? { 'x-api-version': config.doubaoApiVersion } : {},
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
