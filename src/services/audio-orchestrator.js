import { truncateText } from '../utils/text.js';

export class AudioOrchestrator {
  constructor({ config, aiClient, db, logger, getProviderCapabilities, getProviderName }) {
    this.config = config;
    this.aiClient = aiClient;
    this.db = db;
    this.logger = logger;
    this.getProviderCapabilities = getProviderCapabilities;
    this.getProviderName = getProviderName;
  }

  async transcribeIncomingAudio({ file, prompt, locale, userText = '' }) {
    const capabilities = this.getProviderCapabilities();
    const downgradeEvents = [];

    if (this.config.enableLiveAudio && capabilities.liveAudio && capabilities.speechTranscription) {
      try {
        const transcript = await this.aiClient.transcribeAudio({
          buffer: file.buffer,
          filename: file.filename,
          mimeType: file.mimeType,
          prompt: prompt || 'Transcribe the audio accurately.'
        });
        await this.db.incrementStats('voiceTranscriptions');
        return {
          ok: true,
          text: [userText, `Voice transcript:\n${transcript}`].filter(Boolean).join('\n\n'),
          transcript,
          mode: 'live_audio',
          downgradeEvents
        };
      } catch (error) {
        downgradeEvents.push({ from: 'live_audio', to: 'stt', reason: error.message });
        this.logger.warn('Audio downgrade event', {
          provider: this.getProviderName(),
          locale,
          from: 'live_audio',
          to: 'stt',
          reason: error.message
        });
      }
    }

    if (capabilities.speechTranscription) {
      try {
        const transcript = await this.aiClient.transcribeAudio({
          buffer: file.buffer,
          filename: file.filename,
          mimeType: file.mimeType,
          prompt: prompt || 'Transcribe the user audio accurately.'
        });
        await this.db.incrementStats('voiceTranscriptions');
        return {
          ok: true,
          text: [userText, `Voice transcript:\n${transcript}`].filter(Boolean).join('\n\n'),
          transcript,
          mode: 'stt',
          downgradeEvents
        };
      } catch (error) {
        downgradeEvents.push({ from: 'stt', to: 'text', reason: error.message });
        this.logger.warn('Audio downgrade event', {
          provider: this.getProviderName(),
          locale,
          from: 'stt',
          to: 'text',
          reason: error.message
        });
      }
    } else {
      downgradeEvents.push({ from: 'stt', to: 'text', reason: 'provider_capability_missing' });
      this.logger.warn('Audio downgrade event', {
        provider: this.getProviderName(),
        locale,
        from: 'stt',
        to: 'text',
        reason: 'provider_capability_missing'
      });
    }

    return {
      ok: false,
      mode: 'text',
      downgradeEvents,
      text: ''
    };
  }

  async textToSpeech({ input }) {
    const capabilities = this.getProviderCapabilities();
    const downgradeEvents = [];
    const normalizedInput = truncateText(String(input || ''), 4000);

    if (!normalizedInput) {
      return { ok: false, error: 'EMPTY_INPUT', downgradeEvents };
    }

    if (this.config.enableLiveAudio && capabilities.liveAudio && capabilities.speechSynthesis) {
      try {
        const audio = await this.aiClient.generateSpeech({ input: normalizedInput });
        await this.db.incrementStats('ttsGenerations');
        return { ok: true, audio, mode: 'live_audio', downgradeEvents };
      } catch (error) {
        downgradeEvents.push({ from: 'live_audio', to: 'tts', reason: error.message });
        this.logger.warn('Audio downgrade event', {
          provider: this.getProviderName(),
          from: 'live_audio',
          to: 'tts',
          reason: error.message
        });
      }
    }

    if (capabilities.speechSynthesis) {
      try {
        const audio = await this.aiClient.generateSpeech({ input: normalizedInput });
        await this.db.incrementStats('ttsGenerations');
        return { ok: true, audio, mode: 'tts', downgradeEvents };
      } catch (error) {
        downgradeEvents.push({ from: 'tts', to: 'text', reason: error.message });
        this.logger.warn('Audio downgrade event', {
          provider: this.getProviderName(),
          from: 'tts',
          to: 'text',
          reason: error.message
        });
        return { ok: false, error: error.message, downgradeEvents };
      }
    }

    downgradeEvents.push({ from: 'tts', to: 'text', reason: 'provider_capability_missing' });
    this.logger.warn('Audio downgrade event', {
      provider: this.getProviderName(),
      from: 'tts',
      to: 'text',
      reason: 'provider_capability_missing'
    });
    return { ok: false, error: 'SPEECH_SYNTHESIS_UNSUPPORTED', downgradeEvents };
  }
}

