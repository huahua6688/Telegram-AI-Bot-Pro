import { splitMessage, truncateText } from '../utils/text.js';

const TARGET_LANGUAGE_PATTERN =
  '(韩语|韓語|韩国语|韓國語|korean|日语|日語|japanese|英语|英文|english|中文|chinese|高棉语|高棉語|柬埔寨语|柬埔寨語|khmer|粤语|粵語|cantonese|泰语|泰語|thai|马来语|馬來語|malay|越南语|越南語|vietnamese|法语|法語|french|西班牙语|西班牙語|spanish)';

function cleanPlainText(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[\w-]*\n?/, '').replace(/```$/, '').trim()
    )
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[\*•]\s+/gm, '- ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/$begin:math:display$\(\.\*\?\)$end:math:display$$begin:math:text$\(https\?\:\\\/\\\/\[\^\)\]\+\)$end:math:text$/g, '$1 $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function replyLong(ctx, text, maxLength = 3800, extra = undefined) {
  const chunks = splitMessage(cleanPlainText(text), maxLength);
  for (const chunk of chunks) {
    await ctx.reply(chunk, extra);
  }
}

function extractJson(text = '') {
  const raw = String(text || '').trim();

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function hasUsefulToolResult(raw = '') {
  try {
    const data = JSON.parse(String(raw || '').trim());

    if (!data || data.error) return false;
    if (data.current || data.location) return true;
    if (Array.isArray(data.forecast) && data.forecast.length > 0) return true;
    if (Array.isArray(data.results) && data.results.length > 0) return true;
    if (Array.isArray(data.topics) && data.topics.length > 0) return true;
    if (String(data.heading || '').trim()) return true;
    if (String(data.abstract || '').trim()) return true;
    if (String(data.answer || '').trim()) return true;

    return false;
  } catch {
    return String(raw || '').trim().length > 0;
  }
}

function formatToolResult(raw = '', title = '结果') {
  const text = String(raw || '').trim();

  if (!text) {
    return `${title}\n\n没有拿到有效结果。`;
  }

  try {
    const data = JSON.parse(text);

    if (data?.error) {
      return `${title}\n\n${data.message || data.error}`;
    }

    if (!hasUsefulToolResult(text)) {
      return `${title}\n\n没有拿到有效结果。\n如果需要稳定实时搜索，请在 Zeabur 配置 BRAVE_SEARCH_API_KEY。`;
    }

    const lines = [title];

    if (data.location) {
      lines.push('', `地点：${data.location}`);
    }

    if (data.current) {
      lines.push(
        '',
        '当前：',
        `天气：${data.current.weather ?? '-'}`,
        `温度：${data.current.temperatureC ?? '-'}°C`,
        `湿度：${data.current.humidityPercent ?? '-'}%`,
        `降水：${data.current.precipitationMm ?? '-'} mm`,
        `风速：${data.current.windKmh ?? '-'} km/h`
      );
    }

    if (Array.isArray(data.forecast) && data.forecast.length > 0) {
      lines.push('', '预报：');
      for (const item of data.forecast.slice(0, 3)) {
        lines.push(`- ${item.date || '-'}：${item.weather || '-'}，${item.minC ?? '-'}~${item.maxC ?? '-'}°C`);
      }
    }

    if (data.heading) lines.push('', `标题：${data.heading}`);
    if (data.answer) lines.push(`答案：${data.answer}`);
    if (data.abstract) lines.push(`摘要：${data.abstract}`);

    const results = Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.topics)
        ? data.topics
        : [];

    if (results.length > 0) {
      lines.push('', '搜索结果：');

      for (const item of results.slice(0, 5)) {
        const itemTitle = item.title || item.Text || '-';
        const desc = item.description || item.Text || '';
        const url = item.url || item.FirstURL || '';

        lines.push('', `标题：${itemTitle}`);
        if (desc && desc !== itemTitle) lines.push(`摘要：${desc}`);
        if (url) lines.push(`链接：${url}`);
      }
    }

    return lines.join('\n');
  } catch {
    return `${title}\n\n${truncateText(text, 3500)}`;
  }
}

function decodeXml(value = '') {
  return String(value || '')
    .replace(/<!$begin:math:display$CDATA\\\[\(\[\\s\\S\]\*\?\)$end:math:display$\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractXmlTag(block = '', tag = '') {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = String(block || '').match(pattern);
  return match ? decodeXml(match[1]) : '';
}

async function fetchNewsFallback(query = '今日新闻') {
  const q = String(query || '今日新闻').trim();
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(q) +
    '&hl=zh-CN&gl=MY&ceid=MY:zh-Hans';

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Telegram-AI-Bot-Pro'
    }
  });

  if (!response.ok) return '';

  const xml = await response.text();
  const itemPattern = new RegExp('<item>([\\s\\S]*?)<\\/item>', 'gi');
  const items = [];

  for (const match of xml.matchAll(itemPattern)) {
    const block = match[1];
    const title = extractXmlTag(block, 'title');
    const link = extractXmlTag(block, 'link');
    const pubDate = extractXmlTag(block, 'pubDate');

    if (title) items.push({ title, link, pubDate });
    if (items.length >= 5) break;
  }

  if (items.length === 0) return '';

  const lines = ['新闻结果'];

  for (const item of items) {
    lines.push('', `标题：${item.title}`);
    if (item.pubDate) lines.push(`时间：${item.pubDate}`);
    if (item.link) lines.push(`链接：${item.link}`);
  }

  return lines.join('\n');
}

async function executeTool(bot, ctx, name, args, source = 'natural_agent') {
  return bot.toolRegistry.execute(
    {
      function: {
        name,
        arguments: JSON.stringify(args || {})
      }
    },
    {
      source,
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
      isAdmin: bot.isAdmin(ctx),
      toolUsage: { count: 0 }
    }
  );
}

async function runSearch(bot, ctx, query) {
  const locale = bot.getLocale(ctx);
  const keyword = String(query || '').trim();

  if (!keyword) return false;

  try {
    await ctx.sendChatAction('typing');

    const raw = await executeTool(bot, ctx, 'web_search', { query: keyword }, 'natural_agent_search');

    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error) {
        await ctx.reply(bot.formatUserFacingError(parsed.message || parsed.error, locale));
        return true;
      }
    } catch {}

    await bot.db.incrementStats('toolCalls');

    if (!hasUsefulToolResult(raw)) {
      if (/新闻|新聞|今日|今天|最新|news/i.test(keyword)) {
        const newsText = await fetchNewsFallback(keyword);
        if (newsText) {
          await replyLong(ctx, newsText, bot.config.maxOutputChars);
          return true;
        }
      }

      await ctx.reply(
        locale === 'en'
          ? 'No useful search results were returned. For stable web search, configure BRAVE_SEARCH_API_KEY.'
          : '没有搜到有效结果。\n如果需要稳定实时搜索，请在 Zeabur 配置 BRAVE_SEARCH_API_KEY。',
        bot.createToolboxKeyboard?.(locale)
      );
      return true;
    }

    await replyLong(ctx, formatToolResult(raw, locale === 'en' ? 'Web search results' : '联网搜索结果'), bot.config.maxOutputChars);
    return true;
  } catch (error) {
    await ctx.reply(bot.formatUserFacingError(error, locale));
    return true;
  }
}

async function runUrl(bot, ctx, url) {
  const locale = bot.getLocale(ctx);
  const targetUrl = String(url || '').trim();

  if (!/^https?:\/\//i.test(targetUrl)) return false;

  try {
    await ctx.sendChatAction('typing');

    const raw = await executeTool(bot, ctx, 'fetch_url', { url: targetUrl }, 'natural_agent_url');

    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error) {
        await ctx.reply(locale === 'en' ? 'This page cannot be fetched right now.' : '这个网页暂时抓不到，可能是网站禁止机器人访问。');
        return true;
      }
    } catch {}

    await bot.db.incrementStats('toolCalls');
    await replyLong(ctx, formatToolResult(raw, locale === 'en' ? 'URL summary' : '网页摘要'), bot.config.maxOutputChars);
    return true;
  } catch {
    await ctx.reply(locale === 'en' ? 'This page cannot be fetched right now.' : '这个网页暂时抓不到，可能是网站禁止机器人访问。');
    return true;
  }
}

async function runWeather(bot, ctx, location) {
  const locale = bot.getLocale(ctx);
  const place = String(location || '').trim();

  if (!place) return false;

  if (typeof bot.runWeather === 'function') {
    await bot.runWeather(ctx, place);
    return true;
  }

  try {
    const raw = await executeTool(bot, ctx, 'get_weather', { location: place }, 'natural_agent_weather');
    await bot.db.incrementStats('toolCalls');
    await replyLong(ctx, formatToolResult(raw, locale === 'en' ? 'Weather' : '天气'), bot.config.maxOutputChars);
    return true;
  } catch {
    await ctx.reply(locale === 'en' ? 'Weather is not available yet.' : '天气功能暂时不可用。');
    return true;
  }
}

async function classifyNaturally(bot, ctx, text) {
  const locale = bot.getLocale(ctx);
  const model = bot.config.routerModel || bot.config.translationModel || bot.config.defaultModel;

  const prompt = [
    'You are the hidden intent router for a Telegram AI bot.',
    'The user must not need commands.',
    'Decide what the bot should do from natural language.',
    'Return JSON only. No Markdown. No explanation.',
    '',
    'Actions:',
    '- chat: normal conversation, coding help, explanations, opinions, stable knowledge',
    '- translate: translate or rewrite text into another language',
    '- web_search: latest/current/news/search/prices/exchange rates/recent events/current facts',
    '- fetch_url: user sent or asked to read a URL',
    '- weather: weather forecast or current weather for a place',
    '- help: asks what the bot can do or how to use it',
    '',
    'Rules:',
    '- If the user asks news/latest/current/today/recent, use web_search.',
    '- If the user asks weather/hot/rain/temperature for a place, use weather.',
    '- If the user includes a URL, use fetch_url.',
    '- If the user asks translation, use translate and extract targetLanguage and text.',
    '- If unsure, use chat.',
    '',
    'JSON schema:',
    '{"action":"chat|translate|web_search|fetch_url|weather|help","text":"","query":"","url":"","location":"","targetLanguage":"","confidence":0.0}'
  ].join('\n');

  try {
    const completion = await bot.completeWithAiFallback({
      scope: 'router',
      model,
      locale,
      request: {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: text }
        ],
        tools: [],
        temperature: 0
      }
    });

    const parsed = extractJson(completion.result?.text || '');
    if (!parsed || typeof parsed !== 'object') return { action: 'chat', confidence: 0 };

    return {
      action: String(parsed.action || 'chat').trim(),
      text: String(parsed.text || text).trim(),
      query: String(parsed.query || text).trim(),
      url: String(parsed.url || '').trim(),
      location: String(parsed.location || '').trim(),
      targetLanguage: String(parsed.targetLanguage || '').trim(),
      confidence: Number(parsed.confidence || 0)
    };
  } catch (error) {
    if (bot.isAiQuotaError?.(error)) {
      bot.setAiCooldown?.('router', model, error);
    }

    bot.logger?.warn?.('Natural agent router failed; fallback to normal chat', {
      error: bot.formatLogError ? bot.formatLogError(error) : String(error?.message || error)
    });

    return { action: 'chat', confidence: 0 };
  }
}

export async function tryHandleNaturalAgent(bot, ctx) {
  const text = String(ctx.message?.text || '').trim();

  if (!text) return false;

  if (typeof bot.getActiveMode === 'function' && bot.getActiveMode(ctx)) {
    return false;
  }

  const locale = bot.getLocale(ctx);

  const url = text.match(/https?:\/\/[^\s]+/i)?.[0] || '';
  if (url) return runUrl(bot, ctx, url);

  const translateModeRegex = new RegExp(
    `^(?:翻译为|翻译成|翻譯為|翻譯成|translate to)\\s*${TARGET_LANGUAGE_PATTERN}$`,
    'i'
  );

  const translateMode = text.match(translateModeRegex);
  if (translateMode) {
    const targetLanguage = bot.normalizeTranslationTarget(translateMode[1]);
    bot.setActiveMode(ctx, { type: 'translate', targetLanguage });

    await ctx.reply(
      locale === 'en'
        ? 'Translation mode is on. Send text to translate.'
        : `翻译模式已开启。目标语言：${targetLanguage}\n请直接发送要翻译的内容。`,
      bot.createModeKeyboard(locale)
    );
    return true;
  }

  const trailingTranslateRegex = new RegExp(
    `^(?:翻译|翻譯|translate|tr)\\s+([\\s\\S]+?)\\s+${TARGET_LANGUAGE_PATTERN}$`,
    'i'
  );

  const trailingTranslate = text.match(trailingTranslateRegex);
  if (trailingTranslate) {
    const sourceText = trailingTranslate[1].trim();
    const targetLanguage = bot.normalizeTranslationTarget(trailingTranslate[2]);
    await bot.runTranslation(ctx, sourceText, targetLanguage);
    return true;
  }

  const explicitWeather = text.match(/^(?:天气|天氣|查天气|查天氣|weather)\s+(.+)$/i);
  if (explicitWeather) {
    return runWeather(bot, ctx, explicitWeather[1].trim());
  }

  const explicitSearch = text.match(/^(?:搜索|搜一下|联网搜索|上网搜|查一下|web|search)\s+(.+)$/i);
  if (explicitSearch) {
    return runSearch(bot, ctx, explicitSearch[1].trim());
  }

  if (/^(你能做什么|你会什么|有什么功能|怎么用|帮助|help|what can you do)$/i.test(text)) {
    await bot.handleHelp(ctx);
    return true;
  }

  const routed = await classifyNaturally(bot, ctx, text);

  if (routed.action === 'help') {
    await bot.handleHelp(ctx);
    return true;
  }

  if (routed.action === 'translate') {
    const targetLanguage = routed.targetLanguage
      ? bot.normalizeTranslationTarget(routed.targetLanguage)
      : 'auto';

    await bot.runTranslation(ctx, routed.text || text, targetLanguage);
    return true;
  }

  if (routed.action === 'fetch_url') {
    return runUrl(bot, ctx, routed.url || url);
  }

  if (routed.action === 'weather') {
    return runWeather(bot, ctx, routed.location || routed.query || text);
  }

  if (routed.action === 'web_search') {
    return runSearch(bot, ctx, routed.query || text);
  }

  return false;
}

export const naturalAgentInternals = {
  cleanPlainText,
  hasUsefulToolResult,
  formatToolResult,
  fetchNewsFallback,
  classifyNaturally
};
