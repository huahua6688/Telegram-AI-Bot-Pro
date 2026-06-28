function isAssistantToolCallMessage(message) {
  return message?.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

function dropTrailingToolBundle(messages) {
  while (messages.length > 0) {
    const last = messages[messages.length - 1];
    if (isAssistantToolCallMessage(last)) {
      messages.pop();
      break;
    }
    messages.pop();
  }
}

export function sanitizeConversationMessages(messages = []) {
  const sanitized = [];
  let pendingToolCallIds = null;

  for (const message of messages) {
    if (!message?.role) continue;

    if (isAssistantToolCallMessage(message)) {
      if (pendingToolCallIds?.size) {
        dropTrailingToolBundle(sanitized);
      }

      sanitized.push(message);
      pendingToolCallIds = new Set(
        message.tool_calls
          .map((toolCall) => toolCall?.id)
          .filter(Boolean)
      );
      continue;
    }

    if (message.role === 'tool') {
      if (!pendingToolCallIds?.has(message.tool_call_id)) {
        continue;
      }
      sanitized.push(message);
      pendingToolCallIds.delete(message.tool_call_id);
      continue;
    }

    if (pendingToolCallIds?.size) {
      dropTrailingToolBundle(sanitized);
    }
    pendingToolCallIds = null;
    sanitized.push(message);
  }

  if (pendingToolCallIds?.size) {
    dropTrailingToolBundle(sanitized);
  }

  return sanitized;
}

export function buildConversationHistory(messages = [], maxMessages = 0) {
  const limit = maxMessages > 0 ? maxMessages * 3 : messages.length;
  return sanitizeConversationMessages(messages.slice(-limit));
}
