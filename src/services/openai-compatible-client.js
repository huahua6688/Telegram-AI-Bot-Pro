import { truncateText } from '../utils/text.js';

import { createRequestAbort } from '../utils/request-abort.js';
import { readSseJson } from '../utils/sse.js';
import { appendBillingCall, summarizeBillingCalls } from './model-billing-policy.js';

export function attachResponseBilling(payload, headers) {
  if (!payload || typeof payload !== 'object' || ArrayBuffer.isView(payload) || payload instanceof ArrayBuffer) return payload;
  Object.defineProperty(payload, '_billingCall', {
    value: appendBillingCall([], payload, headers),
    enumerable: false,
    configurable: true
  });
  return payload;
}

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

function flattenStreamContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text') return part.text || '';
    return '';
  }).join('');
}

function mergeStreamToolCall(toolCalls, delta = {}, fallbackIndex = 0) {
  const index = Number.isInteger(delta.index) ? delta.index : fallbackIndex;
  const current = toolCalls[index] || {
    id: '',
    type: 'function',
    function: { name: '', arguments: '' }
  };
  current.id += delta.id || '';
  current.type = delta.type || current.type;
  current.function.name += delta.function?.name || '';
  current.function.arguments += delta.function?.arguments || '';
  toolCalls[index] = current;
}

function attachBillingToError(error, billingCalls) {
  if (error && typeof error === 'object') error.billing = summarizeBillingCalls(billingCalls);
  return error;
}

function billingBudgetReached(calls, maximumUsd) {
  const maximum = Number(maximumUsd);
  if (!Number.isFinite(maximum) || maximum <= 0 || calls.length === 0) return false;
  const summary = summarizeBillingCalls(calls);
  return summary.costKnown && Number(summary.actualCostUsd) >= maximum;
}

export class OpenAICompatibleClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async request(endpoint, options = {}) {
    const { signal: externalSignal, requestTimeoutMs, ...fetchOptions } = options;
    const requestAbort = createRequestAbort({
      signal: externalSignal,
      timeoutMs: requestTimeoutMs,
      fallbackTimeoutMs: this.config.requestTimeoutMs
    });

    try {
      const response = await fetch(`${this.config.aiBaseUrl}${endpoint}`, {
        ...fetchOptions,
        headers: {
          Authorization: 'Bearer ' + this.config.aiApiKey,
          ...(fetchOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(fetchOptions.headers || {})
        },
        signal: requestAbort.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI request failed (${response.status}): ${truncateText(body, 600)}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return attachResponseBilling(await response.json(), response.headers);
      }
      return response.arrayBuffer();
    } finally {
      requestAbort.dispose();
    }
  }

  async chatCompletion({
    model,
    messages,
    tools = [],
    temperature = this.config.temperature,
    signal,
    requestTimeoutMs,
    onTextDelta
  }) {
    const payload = {
      model,
      messages,
      temperature,
      max_tokens: Math.max(128, Math.min(16_384, Number(this.config.aiMaxOutputTokens) || 2048))
    };
    if (this.includeUsageCosts) payload.usage = { include: true };

    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    if (typeof onTextDelta === 'function') {
      try {
        return await this.streamChatCompletion(payload, { signal, requestTimeoutMs, onTextDelta });
      } catch (error) {
        const canRetryWithoutStreaming = /AI request failed \((?:400|404|405|415|422)\)/.test(error.message);
        if (!canRetryWithoutStreaming || signal?.aborted) throw error;
        this.logger?.warn?.('Provider rejected streaming; retrying as a regular completion', {
          error: error.message
        });
      }
    }

    return this.request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
      requestTimeoutMs
    });
  }

  async listModels({ signal, requestTimeoutMs } = {}) {
    return this.request('/models', {
      method: 'GET',
      signal,
      requestTimeoutMs
    });
  }

  async streamChatCompletion(payload, { signal, requestTimeoutMs, onTextDelta }) {
    const requestAbort = createRequestAbort({
      signal,
      timeoutMs: requestTimeoutMs,
      fallbackTimeoutMs: this.config.requestTimeoutMs
    });
    const baseUrl = String(this.nativeBaseUrl || this.config.aiBaseUrl || '').replace(/\/$/, '');
    const apiKey = this.nativeApiKey || this.config.aiApiKey;

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          ...(this.nativeHeaders || {})
        },
        body: JSON.stringify({ ...payload, stream: true }),
        signal: requestAbort.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI request failed (${response.status}): ${truncateText(body, 600)}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        return attachResponseBilling(await response.json(), response.headers);
      }

      let content = '';
      const toolCalls = [];
      let finishReason = null;
      let usage;
      await readSseJson(response, async (event) => {
        if (event?.error) {
          throw new Error(`AI streaming failed: ${truncateText(event.error?.message || JSON.stringify(event.error), 600)}`);
        }
        usage = event.usage || usage;
        const choice = event.choices?.[0];
        if (!choice) return;
        finishReason = choice.finish_reason ?? finishReason;
        const delta = choice.delta || {};
        const textDelta = flattenStreamContent(delta.content);
        if (textDelta) {
          content += textDelta;
          await onTextDelta(textDelta, content);
        }
        for (let index = 0; index < (delta.tool_calls || []).length; index += 1) {
          mergeStreamToolCall(toolCalls, delta.tool_calls[index], index);
        }
      });

      return attachResponseBilling({
        choices: [{
          finish_reason: finishReason,
          message: {
            role: 'assistant',
            content,
            tool_calls: toolCalls.filter(Boolean).length > 0 ? toolCalls.filter(Boolean) : undefined
          }
        }],
        usage
      }, response.headers);
    } finally {
      requestAbort.dispose();
    }
  }

  async completeWithTools({ model, messages, tools = [], toolRunner, temperature, signal, requestTimeoutMs, onTextDelta, maxBillingCostUsd = 0 }) {
    const workingMessages = [...messages];
    const billingCalls = [];

    for (let step = 0; step < Math.max(1, this.config.aiMaxToolSteps); step += 1) {
      const response = await this.chatCompletion({
        model,
        messages: workingMessages,
        tools,
        temperature,
        signal,
        requestTimeoutMs,
        onTextDelta
      });
      if (response?._billingCall) billingCalls.push(response._billingCall);
      const choice = response.choices?.[0];
      if (!choice?.message) {
        throw attachBillingToError(new Error('AI provider returned an empty response.'), billingCalls);
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
          raw: response,
          billing: summarizeBillingCalls(billingCalls)
        };
      }

      if (billingBudgetReached(billingCalls, maxBillingCostUsd)) {
        const error = new Error('MODEL_BILLING_BUDGET_REACHED');
        error.code = 'MODEL_BILLING_BUDGET_REACHED';
        throw attachBillingToError(error, billingCalls);
      }
      if (
        Number(maxBillingCostUsd) > 0 &&
        billingCalls.some((call) => !Number.isFinite(call.costUsd))
      ) {
        const error = new Error('MODEL_COST_UNAVAILABLE_FOR_MULTI_STEP_REQUEST');
        error.code = 'MODEL_COST_UNAVAILABLE_FOR_MULTI_STEP_REQUEST';
        throw attachBillingToError(error, billingCalls);
      }

      for (const toolCall of choice.message.tool_calls) {
        let toolResult;
        try {
          toolResult = await toolRunner(toolCall);
        } catch (error) {
          throw attachBillingToError(error, billingCalls);
        }
        workingMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        });
      }
    }

    if (
      billingBudgetReached(billingCalls, maxBillingCostUsd) ||
      (Number(maxBillingCostUsd) > 0 && billingCalls.some((call) => !Number.isFinite(call.costUsd)))
    ) {
      const error = new Error('MODEL_BILLING_BUDGET_REACHED');
      error.code = 'MODEL_BILLING_BUDGET_REACHED';
      throw attachBillingToError(error, billingCalls);
    }

    const finalResponse = await this.chatCompletion({
      model,
      messages: workingMessages,
      temperature,
      signal,
      requestTimeoutMs,
      onTextDelta
    });
    if (finalResponse?._billingCall) billingCalls.push(finalResponse._billingCall);
    const finalChoice = finalResponse.choices?.[0]?.message;
    return {
      text: flattenContent(finalChoice?.content),
      messages: [...workingMessages, { role: 'assistant', content: finalChoice?.content ?? '' }],
      raw: finalResponse,
      billing: summarizeBillingCalls(billingCalls)
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
