import { stripHtml, truncateText } from '../utils/text.js';
import { ToolAccessPolicy } from './tool-access-policy.js';

const USER_AGENT = 'Telegram-AI-Bot-Pro';

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

async function searchWeb(query) {
  const url = new URL('https://api.duckduckgo.com/');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('skip_disambig', '1');

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });
  if (!response.ok) {
    throw new Error(`Search request failed (${response.status})`);
  }

  const data = await response.json();
  const topics = (data.RelatedTopics || [])
    .flatMap((item) => (item.Topics ? item.Topics : [item]))
    .slice(0, 5)
    .map((item) => ({ text: item.Text, url: item.FirstURL }));

  return truncateText(
    JSON.stringify(
      {
        heading: data.Heading,
        abstract: data.AbstractText,
        answer: data.Answer,
        topics
      },
      null,
      2
    ),
    5000
  );
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
    const name = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments || '{}');
    const usage = context.toolUsage || { count: 0 };

    const decision = this.policy.authorize(name, context);
    this.policy.audit(decision, name, context);
    if (!decision.allowed) {
      return JSON.stringify({ error: decision.code, message: decision.message });
    }

    if (usage.count >= this.config.toolMaxCallsPerMessage) {
      const limitDecision = {
        allowed: false,
        code: 'TOOL_CALL_LIMIT_REACHED',
        message: `Tool call limit (${this.config.toolMaxCallsPerMessage}) reached for this request.`
      };
      this.policy.audit(limitDecision, name, context);
      return JSON.stringify({ error: limitDecision.code, message: limitDecision.message });
    }

    if (!this.validateArgs(name, args)) {
      const invalidDecision = {
        allowed: false,
        code: 'TOOL_ARGS_INVALID',
        message: `Invalid arguments for ${name}.`
      };
      this.policy.audit(invalidDecision, name, context);
      return JSON.stringify({ error: invalidDecision.code, message: invalidDecision.message });
    }

    switch (name) {
      case 'get_time':
        usage.count += 1;
        return JSON.stringify({ utc: new Date().toISOString() });
      case 'fetch_url':
        usage.count += 1;
        return fetchUrlText(args.url);
      case 'web_search':
        usage.count += 1;
        return searchWeb(args.query);
      case 'get_weather':
        usage.count += 1;
        return getWeather(args.location);
      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }
}
