import { truncateText } from '../utils/text.js';
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
  return { mimeType: match[1], data: match[2] };
}

function toGeminiParts(content) {
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  if (!Array.isArray(content)) return [{ text: '' }];

  const parts = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push({ text: part });
      continue;
    }
    if (part?.type === 'text') {
      parts.push({ text: part.text || '' });
      continue;
    }
    if (part?.type === 'image_url') {
      const uri = parseDataUri(part.image_url?.url);
      if (!uri) continue;
      parts.push({
        inlineData: {
          mimeType: uri.mimeType,
          data: uri.data
        }
      });
    }
  }

  return parts.length > 0 ? parts : [{ text: '' }];
}

function stripUnsupportedSchemaFields(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const { additionalProperties: _ignored, ...rest } = schema;
  return {
    ...rest,
    ...(rest.properties && {
      properties: Object.fromEntries(
        Object.entries(rest.properties).map(([k, v]) => [k, stripUnsupportedSchemaFields(v)])
      )
    }),
    ...(rest.items && { items: stripUnsupportedSchemaFields(rest.items) })
  };
}

function mapToolDefinitions(definitions = []) {
  if (definitions.length === 0) return undefined;
  return [
    {
      functionDeclarations: definitions.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: stripUnsupportedSchemaFields(
          tool.function.parameters || { type: 'object', properties: {} }
        )
      }))
    }
  ];
}

export class GeminiClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async request(model, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const endpoint = `${this.config.geminiBaseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.config.geminiApiKey)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI request failed (${response.status}): ${truncateText(body, 600)}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  toGeminiPayload(messages, tools = [], temperature = this.config.temperature) {
    const systemParts = [];
    const contents = [];
    const toolCallNameMap = new Map();

    for (const item of messages) {
      if (item.role === 'system') {
        const text = flattenContent(item.content);
        if (text) systemParts.push(text);
        continue;
      }

      if (item.role === 'user') {
        contents.push({
          role: 'user',
          parts: toGeminiParts(item.content)
        });
        continue;
      }

      if (item.role === 'assistant') {
        const parts = [];
        const text = flattenContent(item.content);
        if (text) {
          parts.push({ text });
        }
        for (const toolCall of item.tool_calls || []) {
          toolCallNameMap.set(toolCall.id, toolCall.function?.name || 'tool');
          parts.push({
            functionCall: {
              name: toolCall.function?.name || 'tool',
              args: JSON.parse(toolCall.function?.arguments || '{}')
            }
          });
        }
        contents.push({
          role: 'model',
          parts: parts.length > 0 ? parts : [{ text: '' }]
        });
        continue;
      }

      if (item.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: toolCallNameMap.get(item.tool_call_id) || 'tool',
                response: { content: String(item.content || '') }
              }
            }
          ]
        });
      }
    }

    return {
      systemInstruction: systemParts.length > 0 ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined,
      contents,
      tools: mapToolDefinitions(tools),
      generationConfig: { temperature },
      toolConfig:
        tools.length > 0
          ? {
              functionCallingConfig: { mode: 'AUTO' }
            }
          : undefined
    };
  }

  async chatCompletion({ model, messages, tools = [], temperature = this.config.temperature }) {
    const payload = this.toGeminiPayload(messages, tools, temperature);
    return this.request(model, payload);
  }

  async completeWithTools({ model, messages, tools = [], toolRunner, temperature }) {
    const workingMessages = [...messages];

    for (let step = 0; step < Math.max(1, this.config.aiMaxToolSteps); step += 1) {
      const response = await this.chatCompletion({ model, messages: workingMessages, tools, temperature });
      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) {
        throw new Error('AI provider returned an empty response.');
      }

      const parts = candidate.content.parts;
      const text = parts
        .filter((part) => typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim();
      const toolCalls = parts
        .filter((part) => part.functionCall?.name)
        .map((part, index) => ({
          id: `${Date.now()}-${index}-${part.functionCall.name}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {})
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

    const finalResponse = await this.chatCompletion({ model, messages: workingMessages, temperature });
    const finalText = (finalResponse.candidates?.[0]?.content?.parts || [])
      .filter((part) => typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
    return {
      text: finalText,
      messages: [...workingMessages, { role: 'assistant', content: finalText }],
      raw: finalResponse
    };
  }

  async transcribeAudio() {
    throw new UnsupportedClientFeatureError('gemini', '语音转文字');
  }

  async generateSpeech() {
    throw new UnsupportedClientFeatureError('gemini', '文字转语音');
  }

  async generateImage() {
    throw new UnsupportedClientFeatureError('gemini', '图片生成');
  }
}
