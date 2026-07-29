const SAFE_LOCALE_DEFAULTS = Object.freeze({
  zh: Object.freeze({ region: 'CN', language: 'zh-CN', timeZone: 'Asia/Shanghai' }),
  'zh-hans': Object.freeze({ region: 'CN', language: 'zh-CN', timeZone: 'Asia/Shanghai' }),
  'zh-hant': Object.freeze({ region: 'TW', language: 'zh-TW', timeZone: 'Asia/Taipei' }),
  'zh-cn': Object.freeze({ region: 'CN', language: 'zh-CN', timeZone: 'Asia/Shanghai' }),
  'zh-sg': Object.freeze({ region: 'SG', language: 'zh-CN', timeZone: 'Asia/Singapore' }),
  'zh-tw': Object.freeze({ region: 'TW', language: 'zh-TW', timeZone: 'Asia/Taipei' }),
  'zh-hk': Object.freeze({ region: 'HK', language: 'zh-HK', timeZone: 'Asia/Hong_Kong' }),
  'zh-mo': Object.freeze({ region: 'MO', language: 'zh-HK', timeZone: 'Asia/Macau' }),
  yue: Object.freeze({ region: 'HK', language: 'zh-HK', timeZone: 'Asia/Hong_Kong' }),
  km: Object.freeze({ region: 'KH', language: 'km', timeZone: 'Asia/Phnom_Penh' }),
  ms: Object.freeze({ region: 'MY', language: 'ms', timeZone: 'Asia/Kuala_Lumpur' }),
  id: Object.freeze({ region: 'ID', language: 'id', timeZone: '' }),
  ja: Object.freeze({ region: 'JP', language: 'ja', timeZone: 'Asia/Tokyo' }),
  ko: Object.freeze({ region: 'KR', language: 'ko', timeZone: 'Asia/Seoul' }),
  th: Object.freeze({ region: 'TH', language: 'th', timeZone: 'Asia/Bangkok' }),
  vi: Object.freeze({ region: 'VN', language: 'vi', timeZone: 'Asia/Ho_Chi_Minh' })
});

function normalizedTag(value = '') {
  return String(value || '').trim().replaceAll('_', '-').toLowerCase();
}

export function isValidNewsRegion(value = '', { allowEmpty = true } = {}) {
  const region = String(value || '').trim();
  if (!region) return allowEmpty;
  return /^[a-z]{2}$/i.test(region);
}

export function normalizeNewsRegion(value = '', fallback = '') {
  const region = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(region) ? region : fallback;
}

export function isValidNewsLanguage(value = '', { allowEmpty = true } = {}) {
  const language = String(value || '').trim();
  if (!language) return allowEmpty;
  if (language.toLowerCase() === 'auto') return true;
  try {
    return Boolean(new Intl.Locale(language.replaceAll('_', '-')).language);
  } catch {
    return false;
  }
}

export function normalizeNewsLanguage(value = '', fallback = '') {
  const language = String(value || '').trim();
  if (!language || language.toLowerCase() === 'auto') return fallback;
  try {
    return new Intl.Locale(language.replaceAll('_', '-')).toString();
  } catch {
    return fallback;
  }
}

export function isValidNewsTimeZone(value = '', { allowEmpty = true } = {}) {
  const timeZone = String(value || '').trim();
  if (!timeZone) return allowEmpty;
  if (timeZone.toLowerCase() === 'auto') return true;
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeNewsTimeZone(value = '', fallback = '') {
  const timeZone = String(value || '').trim();
  if (!timeZone || timeZone.toLowerCase() === 'auto') return fallback;
  try {
    return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return fallback;
  }
}

function explicitRegionFromLanguageTag(value = '') {
  const tag = String(value || '').trim().replaceAll('_', '-');
  if (!tag) return '';
  try {
    return normalizeNewsRegion(new Intl.Locale(tag).region);
  } catch {
    return '';
  }
}

function safeLocaleDefaults(...values) {
  for (const value of values) {
    const tag = normalizedTag(value);
    if (!tag) continue;
    if (SAFE_LOCALE_DEFAULTS[tag]) return SAFE_LOCALE_DEFAULTS[tag];
    try {
      const locale = new Intl.Locale(tag);
      const regionKey = locale.region
        ? `${locale.language}-${locale.region.toLowerCase()}`
        : '';
      if (regionKey && SAFE_LOCALE_DEFAULTS[regionKey]) {
        return SAFE_LOCALE_DEFAULTS[regionKey];
      }
      const scriptKey = locale.script
        ? `${locale.language}-${locale.script.toLowerCase()}`
        : '';
      if (scriptKey && SAFE_LOCALE_DEFAULTS[scriptKey]) {
        return SAFE_LOCALE_DEFAULTS[scriptKey];
      }
    } catch {
      // Fall back to the safe base-language table.
    }
    const base = tag.split('-')[0];
    if (SAFE_LOCALE_DEFAULTS[base]) return SAFE_LOCALE_DEFAULTS[base];
  }
  return Object.freeze({ region: '', language: '', timeZone: '' });
}

function localeNewsLanguage(locale = '', telegramLanguageCode = '') {
  const effectiveTag = normalizedTag(locale);
  const telegramTag = normalizedTag(telegramLanguageCode);
  const effectiveBase = effectiveTag.split('-')[0];
  const telegramBase = telegramTag.split('-')[0];
  const values =
    effectiveBase && effectiveBase === telegramBase
      ? [telegramTag, effectiveTag]
      : [effectiveTag, telegramTag];

  for (const value of values) {
    const tag = normalizedTag(value);
    if (!tag || tag === 'auto') continue;
    const preset = safeLocaleDefaults(tag);
    if (preset.language) return preset.language;
    return normalizeNewsLanguage(tag);
  }
  return '';
}

export function resolveEffectiveNewsSettings({
  stored = {},
  config = {},
  locale = '',
  telegramLanguageCode = ''
} = {}) {
  const personalRegion = normalizeNewsRegion(stored.region || stored.newsRegion);
  const personalLanguage = normalizeNewsLanguage(stored.language || stored.newsLanguage);
  const personalTimeZone = normalizeNewsTimeZone(stored.timeZone || stored.newsTimeZone);
  const localeDefaults = safeLocaleDefaults(telegramLanguageCode, locale);
  const explicitTelegramRegion = explicitRegionFromLanguageTag(telegramLanguageCode);

  const configuredRegion = normalizeNewsRegion(config.newsRegion, 'MY');
  const configuredLanguage = normalizeNewsLanguage(config.newsLanguage);
  const configuredTimeZone = normalizeNewsTimeZone(config.newsTimeZone, 'Asia/Kuala_Lumpur');
  const inferredRegion =
    localeDefaults.timeZone
      ? localeDefaults.region
      : personalTimeZone
        ? explicitTelegramRegion
        : '';

  return {
    region:
      personalRegion ||
      inferredRegion ||
      configuredRegion,
    language:
      personalLanguage ||
      localeNewsLanguage(locale, telegramLanguageCode) ||
      configuredLanguage ||
      'en',
    timeZone:
      personalTimeZone ||
      localeDefaults.timeZone ||
      configuredTimeZone,
    inherited: {
      region: !personalRegion,
      language: !personalLanguage,
      timeZone: !personalTimeZone
    }
  };
}

export const newsSettingsInternals = Object.freeze({
  explicitRegionFromLanguageTag,
  safeLocaleDefaults
});
