import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class MistralClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'mistral',
      apiKey: config.mistralApiKey,
      baseUrl: config.mistralBaseUrl,
      capabilities: {
        chat: true,
        toolCalls: true,
        vision: false,
        imageGeneration: false,
        speechSynthesis: false,
        speechTranscription: false
      }
    });
  }
}
