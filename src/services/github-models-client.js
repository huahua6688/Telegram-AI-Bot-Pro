import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

export class GitHubModelsClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'github-models',
      apiKey: config.githubModelsApiKey,
      baseUrl: config.githubModelsBaseUrl,
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
