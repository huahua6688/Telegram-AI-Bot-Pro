import { stripHtml, truncateText } from '../utils/text.js';
import { ToolAccessPolicy } from './tool-access-policy.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; Telegram-AI-Bot-Pro/1.0; +https://github.com/huahua6688/Telegram-AI-Bot-Pro)';
const DEFAULT_SEARCH_TIMEOUT_MS = 4000;
const MAX_SEARCH_TIMEOUT_MS = 8000;

function boundedTimeoutMs(value, fallback = DEFAULT_SEARCH_TIMEOUT_MS, maximum = MAX_SEARCH_TIMEOUT_MS) {
  const parsed = Number(value);
  const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(50, Math.min(maximum, Math.floor(timeoutMs)));
}

function combineSignals(signals = []) {
  const active = signals.filter((signal) => signal && typeof signal === 'object');
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

async function fetchWithTimeout(url, options = {}, { signal, timeoutMs } = {}) {
  const timeoutSignal = AbortSignal.timeout(boundedTimeoutMs(timeoutMs));
  return fetch(url, {
    ...options,
    signal: combineSignals([options.signal, signal, timeoutSignal])
  });
}

function toolError(code, message, { retryable = false } = {}) {
  return JSON.stringify({
    ok: false,
    error: code,
    message,
    retryable
  });
}

async function fetchUrlText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch URL (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await response.json();
    return truncateText(JSON.stringify(json, null, 2), 6000);
  }

  const html = await response.text();
  return truncateText(stripHtml(html), 6000);
}

function decodeSearchText(value = '') {
  const decoded = String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
  return stripHtml(decoded);
}

function normalizeSearchResultUrl(value = '') {
  let href = String(value).replace(/&amp;/gi, '&').trim();
  if (href.startsWith('//')) href = `https:${href}`;

  try {
    const parsed = new URL(href);
    const redirected = parsed.searchParams.get('uddg');
    return redirected || parsed.toString();
  } catch {
    return href;
  }
}

async function searchDuckDuckGoHtml(query, options = {}) {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);

  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.8'
    }
  }, options);
  if (!response.ok) {
    throw new Error(`HTML search request failed (${response.status})`);
  }

  const html = await response.text();
  const results = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] || '';
    if (!/\bresult__a\b/i.test(attributes)) continue;

    const hrefMatch = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    const title = decodeSearchText(match[2]);
    const resultUrl = normalizeSearchResultUrl(hrefMatch?.[2] || '');
    if (!title || !/^https?:\/\//i.test(resultUrl)) continue;
    if (results.some((item) => item.url === resultUrl)) continue;

    const tail = html.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 2400);
    const snippetMatch = tail.match(/<[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    results.push({
      title,
      url: resultUrl,
      snippet: decodeSearchText(snippetMatch?.[1] || '')
    });

    if (results.length >= 5) break;
  }

  return results;
}

async function searchDuckDuckGoInstant(query, options = {}) {
  const url = new URL('https://api.duckduckgo.com/');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('skip_disambig', '1');

  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  }, options);
  if (!response.ok) {
    throw new Error(`Search request failed (${response.status})`);
  }

  const data = await response.json();
  const topics = (data.RelatedTopics || [])
    .flatMap((item) => (item.Topics ? item.Topics : [item]))
    .slice(0, 5)
    .map((item) => ({ text: item.Text, url: item.FirstURL }));

  return {
    heading: data.Heading,
    abstract: data.AbstractText,
    answer: data.Answer,
    topics
  };
}

async function searchWeb(query, { signal, timeoutMs } = {}) {
  const cancelPending = new AbortController();
  const searchSignal = combineSignals([signal, cancelPending.signal]);
  const requestOptions = {
    signal: searchSignal,
    timeoutMs: boundedTimeoutMs(timeoutMs)
  };
  const htmlAttempt = searchDuckDuckGoHtml(query, requestOptions).then((results) => {
    if (results.length === 0) throw new Error('HTML search returned no useful results.');
    return truncateText(JSON.stringify({ provider: 'duckduckgo', query, results }, null, 2), 5000);
  });
  const instantAttempt = searchDuckDuckGoInstant(query, requestOptions).then((instant) => {
    if (!instant.heading && !instant.abstract && !instant.answer && instant.topics.length === 0) {
      throw new Error('Instant search returned no useful results.');
    }
    return truncateText(JSON.stringify({ provider: 'duckduckgo', query, ...instant }, null, 2), 5000);
  });
  // Both requests may still settle after the preferred branch returns. Attach
  // rejection observers now so cancellation never becomes an unhandled promise.
  htmlAttempt.catch(() => undefined);
  instantAttempt.catch(() => undefined);

  try {
    // Instant Answer is fast but often generic or stale. Give the HTML result
    // page a short head start so current links win without making a blocked
    // HTML endpoint consume the whole search budget.
    const htmlPreferred = await Promise.race([
      htmlAttempt.then((value) => ({ status: 'fulfilled', value }), (error) => ({ status: 'rejected', error })),
      new Promise((resolve) => setTimeout(() => resolve({ status: 'pending' }), 200))
    ]);
    if (htmlPreferred.status === 'fulfilled') return htmlPreferred.value;
    if (htmlPreferred.status === 'rejected') return await instantAttempt;
    return await Promise.any([htmlAttempt, instantAttempt]);
  } catch (error) {
    const causes = error instanceof AggregateError ? error.errors : [error];
    const meaningful = causes.find((cause) => cause?.name === 'AbortError' || cause?.name === 'TimeoutError')
      || causes.find((cause) => cause instanceof Error);
    throw meaningful || new Error('Search returned no useful results.');
  } finally {
    cancelPending.abort();
  }
}

function weatherDescription(code) {
  const descriptions = new Map([
    [0, 'Clear sky'],
    [1, 'Mainly clear'],
    [2, 'Partly cloudy'],
    [3, 'Overcast'],
    [45, 'Fog'],
    [48, 'Rime fog'],
    [51, 'Light drizzle'],
    [53, 'Drizzle'],
    [55, 'Heavy drizzle'],
    [61, 'Light rain'],
    [63, 'Rain'],
    [65, 'Heavy rain'],
    [71, 'Light snow'],
    [73, 'Snow'],
    [75, 'Heavy snow'],
    [80, 'Rain showers'],
    [81, 'Rain showers'],
    [82, 'Heavy rain showers'],
    [95, 'Thunderstorm'],
    [96, 'Thunderstorm with hail'],
    [99, 'Thunderstorm with heavy hail']
  ]);
  return descriptions.get(Number(code)) || 'Unknown';
}

async function getWeather(location) {
  const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geocodingUrl.searchParams.set('name', location);
  geocodingUrl.searchParams.set('count', '1');
  geocodingUrl.searchParams.set('language', 'en');
  geocodingUrl.searchParams.set('format', 'json');

  const geocodingResponse = await fetch(geocodingUrl, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!geocodingResponse.ok) {
    throw new Error(`Weather location lookup failed (${geocodingResponse.status})`);
  }

  const place = (await geocodingResponse.json()).results?.[0];
  if (!place) {
    return JSON.stringify({ error: 'LOCATION_NOT_FOUND', message: `Location not found: ${location}` });
  }

  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.searchParams.set('latitude', String(place.latitude));
  forecastUrl.searchParams.set('longitude', String(place.longitude));
  forecastUrl.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m'
  );
  forecastUrl.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
  );
  forecastUrl.searchParams.set('forecast_days', '3');
  forecastUrl.searchParams.set('timezone', 'auto');

  const forecastResponse = await fetch(forecastUrl, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!forecastResponse.ok) {
    throw new Error(`Weather forecast failed (${forecastResponse.status})`);
  }

  const data = await forecastResponse.json();
  const daily = (data.daily?.time || []).map((date, index) => ({
    date,
    weather: weatherDescription(data.daily?.weather_code?.[index]),
    maxC: data.daily?.temperature_2m_max?.[index],
    minC: data.daily?.temperature_2m_min?.[index],
    precipitationProbability: data.daily?.precipitation_probability_max?.[index]
  }));

  return JSON.stringify({
    location: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
    timezone: data.timezone,
    current: {
      time: data.current?.time,
      weather: weatherDescription(data.current?.weather_code),
      temperatureC: data.current?.temperature_2m,
      apparentTemperatureC: data.current?.apparent_temperature,
      humidityPercent: data.current?.relative_humidity_2m,
      windSpeedKmh: data.current?.wind_speed_10m
    },
    forecast: daily
  });
}

export class ToolRegistry {
  constructor(config, logger, accessControl) {
    this.config = config;
    this.logger = logger;
    this.policy = new ToolAccessPolicy(config, logger, accessControl);
  }

  getDefinitions() {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: 'Get the current UTC time.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        }
      }
    ];

    if (this.config.enableUrlFetch) {
      tools.push({
        type: 'function',
        function: {
          name: 'fetch_url',
          description: 'Fetch a web page or JSON resource and return a concise text extract.',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The URL to fetch.'
              }
            },
            required: ['url'],
            additionalProperties: false
          }
        }
      });
    }

    if (this.config.enableWebSearch) {
      tools.push({
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for recent or niche information and return compact results.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query.'
              }
            },
            required: ['query'],
            additionalProperties: false
          }
        }
      });

      tools.push({
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather and a three-day forecast for a city or place.',
          parameters: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description: 'City or place name, including country when ambiguous.'
              }
            },
            required: ['location'],
            additionalProperties: false
          }
        }
      });
    }

    return tools;
  }

  validateArgs(name, args) {
    if (name === 'fetch_url') {
      return typeof args.url === 'string' && /^https?:\/\//i.test(args.url);
    }
    if (name === 'web_search') {
      return typeof args.query === 'string' && args.query.trim().length > 0;
    }
    if (name === 'get_weather') {
      return typeof args.location === 'string' && args.location.trim().length > 0;
    }
    return true;
  }

  async execute(toolCall, context = {}) {
    const name = String(toolCall?.function?.name || '').trim();
    let args;

    try {
      args = JSON.parse(toolCall?.function?.arguments || '{}');
    } catch {
      return toolError('TOOL_ARGS_INVALID', `Arguments for ${name || 'the tool'} were not valid JSON.`);
    }

    const usage = context.toolUsage || { count: 0 };

    const decision = this.policy.authorize(name, context);
    this.policy.audit(decision, name, context);
    if (!decision.allowed) {
      return toolError(decision.code, decision.message);
    }

    if (usage.count >= this.config.toolMaxCallsPerMessage) {
      const limitDecision = {
        allowed: false,
        code: 'TOOL_CALL_LIMIT_REACHED',
        message: `Tool call limit (${this.config.toolMaxCallsPerMessage}) reached for this request.`
      };
      this.policy.audit(limitDecision, name, context);
      return toolError(limitDecision.code, limitDecision.message);
    }

    if (!this.validateArgs(name, args)) {
      const invalidDecision = {
        allowed: false,
        code: 'TOOL_ARGS_INVALID',
        message: `Invalid arguments for ${name}.`
      };
      this.policy.audit(invalidDecision, name, context);
      return toolError(invalidDecision.code, invalidDecision.message);
    }

    try {
      switch (name) {
        case 'get_time':
          usage.count += 1;
          return JSON.stringify({ utc: new Date().toISOString() });
        case 'fetch_url':
          usage.count += 1;
          return await fetchUrlText(args.url);
        case 'web_search':
          usage.count += 1;
          return await searchWeb(args.query, {
            signal: context.signal,
            timeoutMs: boundedTimeoutMs(context.requestTimeoutMs ?? this.config.requestTimeoutMs)
          });
        case 'get_weather':
          usage.count += 1;
          return await getWeather(args.location);
        default:
          return toolError('TOOL_NOT_FOUND', `The requested tool "${name}" is not available.`);
      }
    } catch (error) {
      this.logger?.warn?.('Tool execution failed', {
        tool: name,
        source: context.source || '',
        error: String(error?.message || error)
      });
      return toolError(
        'TOOL_EXECUTION_FAILED',
        'The tool could not complete the request. Try another available approach or explain the limitation.',
        { retryable: true }
      );
    }
  }
}

export const toolRegistryInternals = {
  boundedTimeoutMs,
  fetchWithTimeout,
  searchDuckDuckGoHtml,
  searchDuckDuckGoInstant,
  searchWeb
};
