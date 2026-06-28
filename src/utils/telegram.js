export function normalizeCommand(text = '') {
  return text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
}

export function normalizeLanguageCode(value = '', fallback = 'zh') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('en')) return 'en';
  return fallback;
}

export function extractCommandArgs(text = '') {
  const parts = text.trim().split(/\s+/);
  parts.shift();
  return parts.join(' ').trim();
}

export function shouldRespondToMessage({
  chatType,
  text = '',
  caption = '',
  isReplyToBot = false,
  botUsername = '',
  triggerMode = 'smart',
  keyword = 'ai'
}) {
  if (chatType === 'private') return true;

  const content = `${text} ${caption}`.trim().toLowerCase();
  const normalizedKeyword = keyword.trim().toLowerCase();
  const mention = botUsername ? `@${botUsername.toLowerCase()}` : '';
  const hasMention = mention ? content.includes(mention) : false;
  const hasKeyword = normalizedKeyword ? content.includes(normalizedKeyword) : false;

  switch (triggerMode) {
    case 'all':
      return true;
    case 'mention':
      return hasMention;
    case 'reply':
      return isReplyToBot;
    case 'keyword':
      return hasKeyword;
    case 'smart':
    default:
      return hasMention || isReplyToBot || hasKeyword;
  }
}
