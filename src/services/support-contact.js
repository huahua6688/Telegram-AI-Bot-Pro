const TELEGRAM_USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function isEnglishLocale(locale = '') {
  return String(locale || '').trim().toLowerCase().startsWith('en');
}

export function normalizeSupportBotUsername(value = '') {
  const username = String(value || '').trim().replace(/^@+/, '');
  return TELEGRAM_USERNAME_PATTERN.test(username) ? username : '';
}

export function normalizeSupportContactUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw || CONTROL_CHARACTER_PATTERN.test(raw)) return '';

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function resolveSupportContactUrl(config = {}) {
  if (config?.supportEnabled !== true) return '';

  const configuredUrl = String(config.supportContactUrl || '').trim();
  if (configuredUrl) {
    return normalizeSupportContactUrl(configuredUrl);
  }

  const username = normalizeSupportBotUsername(config.supportBotUsername);
  return username ? `https://t.me/${username}?start=support` : '';
}

export function createSupportButtonData(config = {}, {
  locale = 'zh',
  text = ''
} = {}) {
  const url = resolveSupportContactUrl(config);
  if (!url) return null;

  return {
    text: String(text || '').trim() || (isEnglishLocale(locale) ? 'Contact support' : '联系人工客服'),
    url
  };
}

function cloneKeyboardRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => Array.isArray(row) && row.length > 0)
    .map((row) => row
      .filter((button) => button && typeof button === 'object' && !Array.isArray(button))
      .map((button) => ({ ...button })))
    .filter((row) => row.length > 0);
}

export function mergeInlineKeyboardRows(existingRows = [], appendedRows = []) {
  return [
    ...cloneKeyboardRows(existingRows),
    ...cloneKeyboardRows(appendedRows)
  ];
}

export function appendSupportInlineKeyboardRow(existingRows = [], config = {}, options = {}) {
  const button = createSupportButtonData(config, options);
  const rows = cloneKeyboardRows(existingRows);
  if (!button) return rows;
  const alreadyPresent = rows.some((row) => row.some((candidate) => (
    String(candidate?.url || '') === button.url
  )));
  return alreadyPresent ? rows : mergeInlineKeyboardRows(rows, [[button]]);
}

export const supportContactInternals = {
  TELEGRAM_USERNAME_PATTERN,
  CONTROL_CHARACTER_PATTERN,
  cloneKeyboardRows,
  isEnglishLocale
};
