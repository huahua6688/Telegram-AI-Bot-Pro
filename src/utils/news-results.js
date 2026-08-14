function localDateKey(value, timeZone = 'UTC') {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((item) => [item.type, item.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function parsePublishedTime(value, now = Date.now()) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;

  const relative = raw.match(/^(\d+)\s*(minute|hour)s?\s+ago$/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = relative[2].toLowerCase() === 'hour' ? 60 * 60 * 1000 : 60 * 1000;
    return Number(now) - amount * unitMs;
  }

  return Date.parse(raw);
}

export function filterSearchResultsToToday(raw = '', {
  now = Date.now(),
  timeZone = 'UTC'
} = {}) {
  let payload;
  try {
    payload = JSON.parse(String(raw || ''));
  } catch {
    return '';
  }

  if (!payload || payload.error || !Array.isArray(payload.results)) return '';
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const today = localDateKey(nowMs, timeZone);
  const results = payload.results
    .map((item) => {
      const publishedAtMs = parsePublishedTime(
        item?.publishedAt || item?.published_date || item?.pubDate || item?.page_age || item?.age,
        nowMs
      );
      if (!Number.isFinite(publishedAtMs)) return null;
      if (publishedAtMs - nowMs > 15 * 60 * 1000) return null;
      if (localDateKey(publishedAtMs, timeZone) !== today) return null;
      return {
        ...item,
        publishedAt: new Date(publishedAtMs).toISOString()
      };
    })
    .filter(Boolean);

  if (results.length === 0) return '';
  return JSON.stringify({
    ...payload,
    strictToday: true,
    timeZone,
    results
  });
}

export const newsResultInternals = {
  localDateKey,
  parsePublishedTime
};
