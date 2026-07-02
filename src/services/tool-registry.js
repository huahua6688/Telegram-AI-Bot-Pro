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
      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }
}
