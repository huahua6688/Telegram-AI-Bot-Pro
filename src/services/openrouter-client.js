import { OpenAIStyleNativeClient } from './openai-style-native-client.js';

function openRouterHeaders(config) {
  return {
    ...(config.openrouterHttpReferer ? { 'HTTP-Referer': config.openrouterHttpReferer } : {}),
    ...(config.openrouterAppTitle ? { 'X-Title': config.openrouterAppTitle } : {})
  };
}

export class OpenRouterClient extends OpenAIStyleNativeClient {
  constructor(config, logger) {
    super(config, logger, {
      providerName: 'openrouter',
      apiKey: config.openrouterApiKey,
      baseUrl: config.openrouterBaseUrl,
      headers: openRouterHeaders(config),
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
