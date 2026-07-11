import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class GroqClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'groq',
      apiKey: config.groqApiKey,
      baseUrl: config.groqBaseUrl,
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
