import { truncateText } from '../utils/text.js';
import { createRequestAbort } from '../utils/request-abort.js';
import { UnsupportedClientFeatureError } from './unsupported-client-feature-error.js';

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

function parseDataUri(input = '') {
  const match = String(input).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function toAnthropicContent(content) {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  if (!Array.isArray(content)) return [{ type: 'text', text: '' }];

  const blocks = [];
  for (const part of content) {
    if (typeof part === 'string') {
      blocks.push({ type: 'text', text: part });
      continue;
    }
    if (part?.type === 'text') {
      blocks.push({ type: 'text', text: part.text || '' });
      continue;
    }
    if (part?.type === 'image_url') {
      const uri = parseDataUri(part.image_url?.url);
      if (!uri) continue;
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: uri.mediaType,
          data: uri.data
        }
      });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
}

function mapToolDefinitions(definitions = []) {
  return definitions.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description || '',
    input_schema: tool.function.parameters || { type: 'object', properties: {} }
  }));
}

export class AnthropicClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async request(path, options = {}) {
    const { signal: externalSignal, requestTimeoutMs, ...fetchOptions } = options;
    const requestAbort = createRequestAbort({
      signal: externalSignal,
      timeoutMs: requestTimeoutMs,
      fallbackTimeoutMs: this.config.requestTimeoutMs
    });

    try {
      const response = await fetch(`${this.config.anthropicBaseUrl}${path}`, {
        ...fetchOptions,
        headers: {
          'x-api-key': this.config.anthropicApiKey,
          'anthropic-version': this.config.anthropicApiVersion,
          'Content-Type': 'application/json',
          ...(fetchOptions.headers || {})
        },
        signal: requestAbort.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI request failed (${response.status}): ${truncateText(body, 600)}`);
      }

      return response.json();
    } finally {
      requestAbort.dispose();
    }
  }

  toAnthropicPayloadMessages(messages) {
    const systemParts = [];
    const payloadMessages = [];

    for (const item of messages) {
      if (item.role === 'system') {
        const content = flattenContent(item.content);
        if (content) systemParts.push(content);
        continue;
      }

      if (item.role === 'user') {
        payloadMessages.push({
          role: 'user',
          content: toAnthropicContent(item.content)
        });
        continue;
      }

      if (item.role === 'assistant') {
        const content = [];
        const text = flattenContent(item.content);
        if (text) {
          content.push({ type: 'text', text });
        }
        for (const toolCall of item.tool_calls || []) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function?.name,
            input: JSON.parse(toolCall.function?.arguments || '{}')
          });
        }
        payloadMessages.push({
          role: 'assistant',
          content: content.length > 0 ? content : [{ type: 'text', text: '' }]
        });
        continue;
      }

      if (item.role === 'tool') {
        payloadMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: item.tool_call_id,
              content: String(item.content || '')
            }
          ]
        });
      }
    }

    return { system: systemParts.join('\n\n'), messages: payloadMessages };
  }

  async chatCompletion({
    model,
    messages,
    tools = [],
    temperature = this.config.temperature,
    signal,
    requestTimeoutMs
  }) {
    const { system, messages: payloadMessages } = this.toAnthropicPayloadMessages(messages);
    const payload = {
      model,
      system,
      messages: payloadMessages,
      temperature,
      max_tokens: 2048
    };

    if (tools.length > 0) {
      payload.tools = mapToolDefinitions(tools);
    }

    return this.request('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
      requestTimeoutMs
    });
  }

  async completeWithTools({ model, messages, tools = [], toolRunner, temperature, signal, requestTimeoutMs }) {
    const workingMessages = [...messages];

    for (let step = 0; step < Math.max(1, this.config.aiMaxToolSteps); step += 1) {
      const response = await this.chatCompletion({
        model,
        messages: workingMessages,
        tools,
        temperature,
        signal,
        requestTimeoutMs
      });
      const content = response.content || [];
      const text = content
        .filter((item) => item.type === 'text')
        .map((item) => item.text || '')
        .join('\n')
        .trim();
      const toolCalls = content
        .filter((item) => item.type === 'tool_use')
        .map((item) => ({
          id: item.id,
          type: 'function',
          function: {
            name: item.name,
            arguments: JSON.stringify(item.input || {})
          }
        }));

      const assistantMessage = {
        role: 'assistant',
        content: text,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      };
      workingMessages.push(assistantMessage);

      if (toolCalls.length === 0 || !toolRunner) {
        return {
          text,
          messages: workingMessages,
          raw: response
        };
      }

      for (const toolCall of toolCalls) {
        const toolResult = await toolRunner(toolCall);
        workingMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        });
      }
    }

    const finalResponse = await this.chatCompletion({
      model,
      messages: workingMessages,
      temperature,
      signal,
      requestTimeoutMs
    });
    const finalText = (finalResponse.content || [])
      .filter((item) => item.type === 'text')
      .map((item) => item.text || '')
      .join('\n')
      .trim();
    return {
      text: finalText,
      messages: [...workingMessages, { role: 'assistant', content: finalText }],
      raw: finalResponse
    };
  }

  async transcribeAudio() {
    throw new UnsupportedClientFeatureError('anthropic', '语音转文字');
  }

  async generateSpeech() {
    throw new UnsupportedClientFeatureError('anthropic', '文字转语音');
  }

  async generateImage() {
    throw new UnsupportedClientFeatureError('anthropic', '图片生成');
  }
}
