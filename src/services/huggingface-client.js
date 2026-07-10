import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class HuggingFaceClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'huggingface',
      apiKey: config.huggingfaceApiKey,
      baseUrl: config.huggingfaceBaseUrl,
      capabilities: {
        chat: true,
        toolCalls: false,
        vision: false,
        imageGeneration: false,
        speechSynthesis: false,
        speechTranscription: false
      }
    });
  }
}
