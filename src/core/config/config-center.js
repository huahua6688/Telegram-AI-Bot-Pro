import { validateConfig } from './schema.js';

function toProfile(rawConfig) {
  const provider = {
    default: rawConfig.aiProvider,
    model: rawConfig.defaultModel,
    availableModels: rawConfig.availableModels,
    timeoutMs: rawConfig.requestTimeoutMs,
    credentials: {
      openaiCompatible: {
        apiKey: rawConfig.aiApiKey,
        baseUrl: rawConfig.aiBaseUrl
      },
      anthropic: {
        apiKey: rawConfig.anthropicApiKey,
        baseUrl: rawConfig.anthropicBaseUrl,
        version: rawConfig.anthropicApiVersion
      },
      gemini: {
        apiKey: rawConfig.geminiApiKey,
        baseUrl: rawConfig.geminiBaseUrl
      },
      geminiLive: {
        apiKey: rawConfig.geminiLiveApiKey,
        baseUrl: rawConfig.geminiLiveBaseUrl,
        transcriptionModel: rawConfig.geminiLiveTranscriptionModel,
        ttsModel: rawConfig.geminiLiveTtsModel
      },
      qwen: {
        apiKey: rawConfig.qwenApiKey,
        baseUrl: rawConfig.qwenBaseUrl,
        version: rawConfig.qwenApiVersion
      },
      grok: {
        apiKey: rawConfig.grokApiKey,
        baseUrl: rawConfig.grokBaseUrl,
        version: rawConfig.grokApiVersion
      },
      deepseek: {
        apiKey: rawConfig.deepseekApiKey,
        baseUrl: rawConfig.deepseekBaseUrl,
        version: rawConfig.deepseekApiVersion
      },
      glm: {
        apiKey: rawConfig.glmApiKey,
        baseUrl: rawConfig.glmBaseUrl,
        version: rawConfig.glmApiVersion
      },
      doubao: {
        apiKey: rawConfig.doubaoApiKey,
        baseUrl: rawConfig.doubaoBaseUrl,
        version: rawConfig.doubaoApiVersion
      }
    }
  };

  return {
    platform: {
      botToken: rawConfig.botToken,
      healthPort: rawConfig.healthPort,
      adminApiEnabled: rawConfig.adminApiEnabled,
      adminApiPort: rawConfig.adminApiPort,
      adminApiPrefix: rawConfig.adminApiPrefix
    },
    provider,
    features: {
      toolCalls: rawConfig.enableToolCalls,
      webSearch: rawConfig.enableWebSearch,
      urlFetch: rawConfig.enableUrlFetch,
      streamingReplies: rawConfig.enableStreamingReplies
    },
    limits: {
      maxHistoryMessages: rawConfig.maxHistoryMessages,
      maxInputChars: rawConfig.maxInputChars,
      maxOutputChars: rawConfig.maxOutputChars,
      rateLimitWindowMs: rawConfig.rateLimitWindowMs,
      rateLimitMaxRequests: rawConfig.rateLimitMaxRequests,
      dailyQuota: rawConfig.dailyQuota,
      aiMaxToolSteps: rawConfig.aiMaxToolSteps
    },
    deploy: {
      databaseFile: rawConfig.databaseFile,
      legacyDataFile: rawConfig.legacyDataFile,
      groupTriggerMode: rawConfig.groupTriggerMode,
      groupTriggerKeyword: rawConfig.groupTriggerKeyword
    },
    security: {
      adminUserIds: rawConfig.adminUserIds,
      allowedUserIds: rawConfig.allowedUserIds,
      allowedChatIds: rawConfig.allowedChatIds,
      blockedUserIds: rawConfig.blockedUserIds
    },
    ux: {
      systemPrompt: rawConfig.systemPrompt,
      personaPresets: rawConfig.personaPresets,
      temperature: rawConfig.temperature,
      ttsModel: rawConfig.ttsModel,
      ttsVoice: rawConfig.ttsVoice,
      imageModel: rawConfig.imageModel,
      imageSize: rawConfig.imageSize,
      streamingEditIntervalMs: rawConfig.streamingEditIntervalMs,
      streamingMinLength: rawConfig.streamingMinLength
    },
    raw: rawConfig
  };
}

export function createConfigCenter(rawConfig) {
  const validated = validateConfig(rawConfig);
  return toProfile(validated);
}
