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

  async transcribeIncomingAudio({
    file,
    prompt,
    locale,
    userText = '',
    aiClient = null,
    capabilities = null,
    providerName = ''
  }) {
    const activeClient = aiClient || this.aiClient;
    const activeCapabilities = capabilities || this.getProviderCapabilities();
    const activeProviderName = providerName || this.getProviderName();
    const downgradeEvents = [];

    if (activeCapabilities.speechTranscription) {
      const mode = this.config.enableLiveAudio && activeCapabilities.liveAudio ? 'live_audio' : 'stt';
      try {
        const transcript = await activeClient.transcribeAudio({
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
          mode,
          downgradeEvents
        };
      } catch (error) {
        downgradeEvents.push({ from: mode, to: 'text', reason: error.message });
        this.logger.warn('Audio downgrade event', {
          provider: activeProviderName,
          locale,
          from: mode,
          to: 'text',
          reason: error.message
        });
      }
    } else {
      downgradeEvents.push({ from: 'stt', to: 'text', reason: 'provider_capability_missing' });
      this.logger.warn('Audio downgrade event', {
        provider: activeProviderName,
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

  async textToSpeech({ input, aiClient = null, capabilities = null, providerName = '' }) {
    const activeClient = aiClient || this.aiClient;
    const activeCapabilities = capabilities || this.getProviderCapabilities();
    const activeProviderName = providerName || this.getProviderName();
    const downgradeEvents = [];
    const normalizedInput = truncateText(String(input || ''), 4000);

    if (!normalizedInput) {
      return { ok: false, error: 'EMPTY_INPUT', downgradeEvents };
    }

    if (activeCapabilities.speechSynthesis) {
      const mode = this.config.enableLiveAudio && activeCapabilities.liveAudio ? 'live_audio' : 'tts';
      try {
        const audio = await activeClient.generateSpeech({ input: normalizedInput });
        await this.db.incrementStats('ttsGenerations');
        return { ok: true, audio, mode, downgradeEvents };
      } catch (error) {
        downgradeEvents.push({ from: mode, to: 'text', reason: error.message });
        this.logger.warn('Audio downgrade event', {
          provider: activeProviderName,
          from: mode,
          to: 'text',
          reason: error.message
        });
        return { ok: false, error: error.message, downgradeEvents };
      }
    }

    downgradeEvents.push({ from: 'tts', to: 'text', reason: 'provider_capability_missing' });
    this.logger.warn('Audio downgrade event', {
      provider: activeProviderName,
      from: 'tts',
      to: 'text',
      reason: 'provider_capability_missing'
    });
    return { ok: false, error: 'SPEECH_SYNTHESIS_UNSUPPORTED', downgradeEvents };
  }
}

