import { toDataUri, truncateText } from '../utils/text.js';

export class MultimodalActionService {
  constructor({ aiClient, db, logger, getProviderCapabilities, getProviderName }) {
    this.aiClient = aiClient;
    this.db = db;
    this.logger = logger;
    this.getProviderCapabilities = getProviderCapabilities;
    this.getProviderName = getProviderName;
  }

  buildVisionPrompt(locale, text = '') {
    return (
      truncateText(text || '', 3000) ||
      (locale === 'en' ? 'Please analyze this image.' : '请分析这张图片。')
    );
  }

  createImageUnderstandingMessage({ locale, text, file }) {
    const capabilities = this.getProviderCapabilities();
    if (!capabilities.vision) {
      return {
        ok: false,
        code: 'VISION_UNSUPPORTED'
      };
    }

    return {
      ok: true,
      message: {
        role: 'user',
        content: [
          { type: 'text', text: this.buildVisionPrompt(locale, text) },
          { type: 'image_url', image_url: { url: toDataUri(file.buffer, file.mimeType) } }
        ]
      }
    };
  }

  async runImageAction({ mode, prompt, imageBuffer, mimeType }) {
    const capabilities = this.getProviderCapabilities();
    const provider = this.getProviderName();

    if (mode === 'generate') {
      if (!capabilities.imageGeneration) {
        return {
          ok: false,
          code: 'IMAGE_GENERATION_UNSUPPORTED',
          message: `Provider ${provider} does not support image generation.`
        };
      }
      const response = await this.aiClient.generateImage({ prompt });
      await this.db.incrementStats('aiCalls');
      await this.db.incrementStats('imageGenerations');
      return { ok: true, mode, response };
    }

    if (mode === 'edit') {
      if (!capabilities.imageEditing || typeof this.aiClient.editImage !== 'function') {
        return {
          ok: false,
          code: 'IMAGE_EDIT_UNSUPPORTED',
          message: `Provider ${provider} does not support image editing.`
        };
      }
      const response = await this.aiClient.editImage({ prompt, imageBuffer, mimeType });
      await this.db.incrementStats('aiCalls');
      await this.db.incrementStats('imageGenerations');
      return { ok: true, mode, response };
    }

    return {
      ok: false,
      code: 'IMAGE_ACTION_UNSUPPORTED',
      message: `Unsupported image action: ${mode}`
    };
  }

  pickImageResultItem(response) {
    const item = response?.data?.[0];
    if (!item) return null;
    if (item.url) return { type: 'url', value: item.url };
    if (item.b64_json) return { type: 'base64', value: item.b64_json };
    return null;
  }
}

