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

function messageCharCost(message = {}) {
  const content =
    typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content || '');
  const toolCalls = Array.isArray(message.tool_calls)
    ? JSON.stringify(message.tool_calls)
    : '';
  return content.length + toolCalls.length + 24;
}

function groupConversationMessages(messages = []) {
  const groups = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (!isAssistantToolCallMessage(message)) {
      groups.push([message]);
      continue;
    }

    const group = [message];
    const expectedIds = new Set(
      message.tool_calls.map((toolCall) => toolCall?.id).filter(Boolean)
    );

    while (index + 1 < messages.length && messages[index + 1]?.role === 'tool') {
      const toolMessage = messages[index + 1];
      if (!expectedIds.has(toolMessage.tool_call_id)) break;
      group.push(toolMessage);
      expectedIds.delete(toolMessage.tool_call_id);
      index += 1;
    }

    groups.push(group);
  }

  return groups;
}

export function buildConversationHistory(messages = [], maxMessages = 0, maxChars = 0) {
  const sanitized = sanitizeConversationMessages(messages);
  const groups = groupConversationMessages(sanitized);
  const messageLimit = maxMessages > 0 ? maxMessages * 3 : Number.POSITIVE_INFINITY;
  const charLimit = maxChars > 0 ? maxChars : Number.POSITIVE_INFINITY;
  const selected = [];
  let selectedMessages = 0;
  let selectedChars = 0;

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    const groupChars = group.reduce((total, message) => total + messageCharCost(message), 0);

    if (selectedMessages + group.length > messageLimit) break;
    if (selectedChars + groupChars > charLimit) break;

    selected.unshift(group);
    selectedMessages += group.length;
    selectedChars += groupChars;
  }

  return selected.flat();
}
