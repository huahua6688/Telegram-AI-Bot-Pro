import { truncateText } from '../utils/text.js';

function flattenContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      return '';
    })
    .join('\n')
    .trim();
}

export class OpenAICompatibleClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async request(endpoint, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(`${this.config.aiBaseUrl}${endpoint}`, {
        ...options,
        headers: {
          Authorization: 'Bearer ' + this.config.aiApiKey,
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(options.headers || {})
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI request failed (${response.status}): ${truncateText(body, 600)}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json();
      }
      return response.arrayBuffer();
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatCompletion({ model, messages, tools = [], temperature = this.config.temperature }) {
    const payload = {
      model,
      messages,
      temperature
    };

    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    return this.request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async completeWithTools({ model, messages, tools = [], toolRunner, temperature }) {
    const workingMessages = [...messages];

    for (let step = 0; step < Math.max(1, this.config.aiMaxToolSteps); step += 1) {
      const response = await this.chatCompletion({ model, messages: workingMessages, tools, temperature });
      const choice = response.choices?.[0];
      if (!choice?.message) {
        throw new Error('AI provider returned an empty response.');
      }

      const assistantMessage = {
        role: 'assistant',
        content: choice.message.content ?? '',
        tool_calls: choice.message.tool_calls ?? undefined
      };
      workingMessages.push(assistantMessage);

      if (!choice.message.tool_calls?.length || !toolRunner) {
        return {
          text: flattenContent(choice.message.content),
          messages: workingMessages,
          raw: response
        };
      }

      for (const toolCall of choice.message.tool_calls) {
        const toolResult = await toolRunner(toolCall);
        workingMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        });
      }
    }

    const finalResponse = await this.chatCompletion({ model, messages: workingMessages, temperature });
    const finalChoice = finalResponse.choices?.[0]?.message;
    return {
      text: flattenContent(finalChoice?.content),
      messages: [...workingMessages, { role: 'assistant', content: finalChoice?.content ?? '' }],
      raw: finalResponse
    };
  }

  async transcribeAudio({ buffer, filename, mimeType, prompt = '' }) {
    const form = new FormData();
    form.append('model', this.config.transcriptionModel);
    if (prompt) {
      form.append('prompt', prompt);
    }
    form.append('file', new Blob([buffer], { type: mimeType }), filename);

    const response = await this.request('/audio/transcriptions', {
      method: 'POST',
      body: form,
      headers: {}
    });

    return response.text || response.transcript || '';
  }

  async generateSpeech({ input, voice }) {
    const buffer = await this.request('/audio/speech', {
      method: 'POST',
      body: JSON.stringify({
        model: this.config.ttsModel,
        voice: voice || this.config.ttsVoice,
        input
      })
    });

    return Buffer.from(buffer);
  }

  async generateImage({ prompt }) {
    return this.request('/images/generations', {
      method: 'POST',
      body: JSON.stringify({
        model: this.config.imageModel,
        prompt,
        size: this.config.imageSize
      })
    });
  }

  async editImage({ prompt, imageBuffer, mimeType = 'image/png' }) {
    const form = new FormData();
    form.append('model', this.config.imageModel);
    form.append('prompt', String(prompt || ''));
    form.append('image', new Blob([imageBuffer], { type: mimeType }), 'image.png');
    form.append('size', this.config.imageSize);

    return this.request('/images/edits', {
      method: 'POST',
      body: form,
      headers: {}
    });
  }
}
