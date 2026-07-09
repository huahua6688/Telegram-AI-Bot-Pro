export function normalizeCommand(text = '') {
  return text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
}

export function normalizeLanguageCode(value = '', fallback = 'zh') {
  const raw = String(value || '').trim().toLowerCase().replaceAll('_', '-');
  if (!raw) return fallback;
  if (raw === 'auto') return 'auto';

  if (
    raw.startsWith('zh-hant') ||
    raw.startsWith('zh-tw') ||
    raw.startsWith('zh-hk') ||
    raw.startsWith('zh-mo')
  ) {
    return 'zh-hant';
  }

  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('en')) return 'en';

  // Accept normal Telegram-style language codes:
  // km, ms, ko-KR, ja-JP, pt-BR, es-419
  // Reject broken values like bad_language_code.
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/.test(raw)) {
    return fallback;
  }

  const base = raw.split('-')[0];

  if (/^[a-z]{2,3}$/.test(base)) {
    return base;
  }

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
