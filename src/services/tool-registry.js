import { stripHtml, truncateText } from '../utils/text.js';

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

export class ToolRegistry {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
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
    }

    return tools;
  }

  async execute(toolCall) {
    const name = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments || '{}');

    switch (name) {
      case 'get_time':
        return JSON.stringify({ utc: new Date().toISOString() });
      case 'fetch_url':
        return fetchUrlText(args.url);
      case 'web_search':
        return searchWeb(args.query);
      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }
}
