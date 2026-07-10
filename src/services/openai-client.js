import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class OpenAIClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'openai',
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
      capabilities: {
        chat: true,
        toolCalls: true,
        vision: true,
        imageGeneration: true,
        imageEditing: true,
        speechSynthesis: true,
        speechTranscription: true
      }
    });
  }
}
