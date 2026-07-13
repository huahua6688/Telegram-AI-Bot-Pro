import { GeminiClient } from './gemini-client.js';
import { UnsupportedClientFeatureError } from './unsupported-client-feature-error.js';
import { createRequestAbort } from '../utils/request-abort.js';

function extractTextFromResponse(response) {
  return (response.candidates?.[0]?.content?.parts || [])
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export class GeminiLiveClient extends GeminiClient {
  constructor(config, logger) {
    super(config, logger);
    this.providerName = 'gemini-live';
    this.liveBaseUrl = config.geminiLiveBaseUrl;
    this.liveApiKey = config.geminiLiveApiKey;
    this.capabilities = {
      chat: true,
      toolCalls: false,
      vision: true,
      imageGeneration: false,
      speechSynthesis: true,
      speechTranscription: true,
      liveAudio: true,
      liveTranslate: false,
      nativeAudio: true
    };
  }

  getProviderName() {
    return this.providerName;
  }

  getCapabilities() {
    return this.capabilities;
  }

  async request(model, payload, { signal, requestTimeoutMs } = {}) {
    const requestAbort = createRequestAbort({
      signal,
      timeoutMs: requestTimeoutMs,
      fallbackTimeoutMs: this.config.requestTimeoutMs
    });

    try {
      const endpoint = `${this.liveBaseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.liveApiKey)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: requestAbort.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI request failed (${response.status}): ${body.slice(0, 600)}`);
      }

      return response.json();
    } finally {
      requestAbort.dispose();
    }
  }

  async transcribeAudio({ buffer, mimeType, prompt = '' }) {
    const response = await this.request(this.config.geminiLiveTranscriptionModel || this.config.defaultModel, {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt || 'Transcribe the audio accurately. Output only the transcription text.'
            },
            {
              inlineData: {
                mimeType: mimeType || 'audio/ogg',
                data: Buffer.from(buffer).toString('base64')
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0
      }
    });
    return extractTextFromResponse(response);
  }

  async generateSpeech({ input }) {
    const response = await this.request(this.config.geminiLiveTtsModel || this.config.defaultModel, {
      contents: [
        {
          role: 'user',
          parts: [{ text: String(input || '') }]
        }
      ],
      generationConfig: {
        temperature: 0,
        responseModalities: ['AUDIO']
      }
    });
    const audioPart = (response.candidates?.[0]?.content?.parts || []).find(
      (part) => part.inlineData?.data
    );
    if (!audioPart?.inlineData?.data) {
      throw new Error('Gemini Live did not return audio output.');
    }
    return Buffer.from(audioPart.inlineData.data, 'base64');
  }

  async generateImage() {
    throw new UnsupportedClientFeatureError(this.providerName, '图片生成');
  }
}
