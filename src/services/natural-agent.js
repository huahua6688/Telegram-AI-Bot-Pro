import { splitMessage, truncateText } from '../utils/text.js';
import { createTelegramSessionId as createSessionId, getTelegramReplyContext } from '../utils/telegram.js';
import { personaPresets } from '../config.js';

const TARGET_LANGUAGE_PATTERN =
  '(韩语|韓語|韩国语|韓國語|korean|日语|日語|japanese|英语|英文|english|中文|chinese|高棉语|高棉語|柬埔寨语|柬埔寨語|khmer|粤语|粵語|cantonese|泰语|泰語|thai|马来语|馬來語|malay|越南语|越南語|vietnamese|法语|法語|french|西班牙语|西班牙語|spanish)';

function escapeHtml(value = '') {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value = '') {
  return escapeHtml(value).replaceAll("'", '&#39;');
}

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
    .replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, '$1 $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function replyHtml(ctx, text, maxLength = 3600, extra = undefined) {
  const chunks = splitMessage(String(text || '').trim(), maxLength);

  for (const chunk of chunks) {
    await ctx.reply(chunk, {
      ...(extra || {}),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }
    });
  }
}

async function replyPlain(ctx, text, maxLength = 3800, extra = undefined) {
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

function getRecentContext(bot, ctx) {
  try {
    const sessionId = createSessionId(ctx);
    const stored = bot.db.getConversationForContext?.(sessionId, {
      maxMessages: 8,
      strategy: 'recent'
    });

    const messages = Array.isArray(stored)
      ? stored
      : Array.isArray(stored?.messages)
        ? stored.messages
        : [];

    return messages
      .filter((item) => item?.role === 'user' || item?.role === 'assistant')
      .slice(-8)
      .map((item) => {
        const role = item.role === 'assistant' ? 'assistant' : 'user';
        const content = truncateText(String(item.content || item.text || ''), 500);
        return `${role}: ${content}`;
      })
      .filter((line) => line.trim().length > 8)
      .join('\n');
  } catch {
    return '';
  }
}


function stripGeneratedReferences(answer = '') {
  return String(answer || '')
    .replace(/\n{0,2}(参考链接|参考来源|来源|References|Sources)\s*[:：]?[\s\S]*$/i, '')
    .trim();
}

function stripBareUrls(text = '') {
  return String(text || '')
    .replace(/https?:\/\/[^\s<>)）]+/g, '')
    .replace(/\$begin:math:text$\\s\*\$end:math:text$/g, '')
    .replace(/（\s*）/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function rememberHandledInteraction(bot, ctx, userText = '', assistantText = '', model = '') {
  try {
    const sessionId = createSessionId(ctx);
    const current = Array.isArray(bot.db.getConversation?.(sessionId))
      ? bot.db.getConversation(sessionId)
      : [];

    const userContent = String(userText || '').trim();
    const assistantContent = cleanPlainText(stripBareUrls(stripGeneratedReferences(assistantText))).trim();

    if (!userContent || !assistantContent) return;

    const next = [
      ...current,
      { role: 'user', content: userContent },
      { role: 'assistant', content: truncateText(assistantContent, 8000), model: model || bot.config?.defaultModel || '' }
    ];

    const maxMessages = Math.max(20, Number(bot.config?.maxHistoryMessages || 20) * 3);
    await bot.db.setConversation(sessionId, next.slice(-maxMessages));
  } catch (error) {
    bot.logger?.warn?.('Failed to remember natural-agent interaction', {
      error: bot.formatLogError ? bot.formatLogError(error) : String(error?.message || error)
    });
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

function normalizeUrl(url = '') {
  const raw = String(url || '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';

  try {
    const u = new URL(raw);

    if (u.hostname.includes('news.google.com') && u.searchParams.get('url')) {
      return u.searchParams.get('url') || raw;
    }

    return raw;
  } catch {
    return raw;
  }
}

function extractReferenceLinks(raw = '') {
  const links = [];

  function add(title, url) {
    const cleanUrl = normalizeUrl(url);
    const cleanTitle = cleanPlainText(title || '');

    if (!cleanUrl) return;
    if (links.some((item) => item.url === cleanUrl)) return;

    let label = cleanTitle || cleanUrl.replace(/^https?:\/\//, '').split('/')[0] || '来源';
    label = truncateText(label.replace(/\s+/g, ' ').trim(), 80);

    links.push({ title: label, url: cleanUrl });
  }

  try {
    const data = JSON.parse(String(raw || '').trim());

    const results = Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.topics)
        ? data.topics
        : [];

    for (const item of results) {
      add(item.title || item.Text || item.name, item.url || item.FirstURL || item.link);
      if (links.length >= 3) break;
    }

    if (data.url) add(data.heading || data.title || '网页来源', data.url);
  } catch {
    const urls = String(raw || '').match(/https?:\/\/[^\s)）]+/g) || [];
    for (const url of urls) {
      add('', url);
      if (links.length >= 3) break;
    }
  }

  return links.slice(0, 3);
}

function compactToolPayload(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return '';

  try {
    const data = JSON.parse(text);

    const results = Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.topics)
        ? data.topics
        : [];

    return JSON.stringify(
      {
        heading: data.heading || '',
        answer: data.answer || '',
        abstract: data.abstract || '',
        location: data.location || '',
        current: data.current || null,
        forecast: Array.isArray(data.forecast) ? data.forecast.slice(0, 5) : [],
        results: results.slice(0, 8).map((item) => ({
          title: item.title || item.Text || '',
          description: item.description || item.Text || '',
          url: item.url || item.FirstURL || item.link || ''
        }))
      },
      null,
      2
    );
  } catch {
    return truncateText(text, 6000);
  }
}

function appendClickableReferences(answer = '', raw = '') {
  const links = extractReferenceLinks(raw);
  const cleanedAnswer = stripBareUrls(stripGeneratedReferences(answer));
  const body = escapeHtml(cleanPlainText(cleanedAnswer));

  if (!links.length) return body;

  const refLines = links.map((item, index) => {
    return `${index + 1}. <a href="${escapeAttr(item.url)}">${escapeHtml(item.title)}</a>`;
  });

  return `${body}\n\n参考链接：\n${refLines.join('\n')}`;
}

function rawFallbackText(raw = '', title = '结果') {
  const text = String(raw || '').trim();

  if (!text) return `${title}\n\n没有拿到有效结果。`;

  try {
    const data = JSON.parse(text);

    if (data?.error) return `${title}\n\n${data.message || data.error}`;

    if (!hasUsefulToolResult(text)) {
      return `${title}\n\n没有拿到有效结果。需要稳定实时搜索的话，请配置 BRAVE_SEARCH_API_KEY。`;
    }

    const lines = [title];

    if (data.location) lines.push('', `地点：${data.location}`);

    if (data.current) {
      lines.push(
        '',
        '当前：',
        `天气：${data.current.weather ?? '-'}`,
        `温度：${data.current.temperatureC ?? '-'}°C`,
        `湿度：${data.current.humidityPercent ?? '-'}%`
      );
    }

    const results = Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.topics)
        ? data.topics
        : [];

    if (results.length > 0) {
      lines.push('', '简要结果：');
      for (const item of results.slice(0, 5)) {
        const itemTitle = item.title || item.Text || '-';
        const desc = item.description || item.Text || '';
        lines.push(`- ${itemTitle}${desc && desc !== itemTitle ? `：${desc}` : ''}`);
      }
    }

    return lines.join('\n');
  } catch {
    return `${title}\n\n${truncateText(text, 3500)}`;
  }
}

function decodeXml(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
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

async function fetchNewsFallback(query = '今日新闻', { signal, timeoutMs } = {}) {
  const q = String(query || '今日新闻').trim();
  const parsedTimeout = Number(timeoutMs);
  const boundedTimeout = Math.max(50, Math.min(
    8000,
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? Math.floor(parsedTimeout) : 4000
  ));
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(q) +
    '&hl=zh-CN&gl=MY&ceid=MY:zh-Hans';

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Telegram-AI-Bot-Pro' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(boundedTimeout)]) : AbortSignal.timeout(boundedTimeout)
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
    if (items.length >= 6) break;
  }

  if (items.length === 0) return '';

  return JSON.stringify({
    results: items.map((item) => ({
      title: item.title,
      description: item.pubDate,
      url: item.link
    }))
  });
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



function getPersonaInstruction(bot, ctx) {
  try {
    const user = bot.db.findUser(ctx.from?.id);
    const persona = user?.persona || 'default';
    const prompt = personaPresets[persona] || personaPresets.default || '';

    if (!prompt) return 'Persona: default general assistant.';
    return `Persona: ${persona}\n${prompt}`;
  } catch {
    return 'Persona: default general assistant.';
  }
}

function getEffectiveAISettings(bot, ctx) {
  try {
    return bot.getEffectiveAISettings?.(ctx.from?.id) || {};
  } catch {
    return {};
  }
}

function modelName(bot, ctx) {
  const settings = getEffectiveAISettings(bot, ctx);
  return settings.modelId || bot.config?.routerModel || bot.config?.translationModel || bot.config?.defaultModel || '';
}

function providerId(bot, ctx) {
  const settings = getEffectiveAISettings(bot, ctx);
  return settings.providerId || bot.config?.aiProvider || '';
}

function fallbackEnabled(bot, ctx) {
  const settings = getEffectiveAISettings(bot, ctx);
  return Object.hasOwn(settings, 'fallbackEnabled')
    ? Boolean(settings.fallbackEnabled)
    : Boolean(bot.config?.enableProviderFallback);
}


async function composeHumanAnswer(bot, ctx, { userText, toolName, raw, title }) {
  const locale = bot.getLocale(ctx);
  const model = modelName(bot, ctx);
  const payload = compactToolPayload(raw);
  const recentContext = getRecentContext(bot, ctx);
  const personaInstruction = getPersonaInstruction(bot, ctx);

  if (!payload) {
    return locale === 'en' ? 'No useful result was found.' : '没有拿到有效结果。';
  }

  try {
    const completion = await bot.completeWithAiFallback({
      scope: 'answer_composer',
      userId: ctx.from?.id,
      preferredProvider: providerId(bot, ctx),
      fallbackEnabled: fallbackEnabled(bot, ctx),
      model,
      locale,
      request: {
        messages: [
          {
            role: 'system',
            content: [
              'You are the final answer composer for a Telegram AI bot.',
              personaInstruction || 'Persona: default general assistant.',
              'Behave like ChatGPT: infer missing details from context, answer naturally, and do not expose internal tool output.',
              'Always answer in the same language as the user. For Chinese users, use Simplified Chinese.',
              'Do not dump JSON.',
              'Do not dump raw original titles and links as the main answer.',
              'Do not say “according to the search results” too mechanically.',
              'Give a useful synthesized answer first.',
              'For news/search: summarize the key points, explain what matters, and avoid copying original titles verbatim.',
              'For URL pages: explain what the page is about and what the user should know.',
              'For weather: answer directly with practical advice.',
              'Do not include raw URLs in the answer body. References will be appended separately as clickable links.',
              'Keep the reply concise but complete.'
            ].join('\n')
          },
          {
            role: 'user',
            content: [
              recentContext ? `Recent conversation context:\n${recentContext}\n` : '',
              `Current user message: ${userText}`,
              `Tool used: ${toolName}`,
              `Display title: ${title}`,
              '',
              'Tool result:',
              payload
            ].join('\n')
          }
        ],
        tools: [],
        temperature: 0.25
      }
    });

    return String(completion.result?.text || '').trim() || rawFallbackText(raw, title);
  } catch (error) {
    bot.logger?.warn?.('Answer composer failed; fallback to formatted raw result', {
      error: bot.formatLogError ? bot.formatLogError(error) : String(error?.message || error)
    });

    return rawFallbackText(raw, title);
  }
}

async function runSearch(bot, ctx, query, originalText = query) {
  const locale = bot.getLocale(ctx);
  const keyword = String(query || '').trim();

  if (!keyword) return false;
  if (typeof bot.consumeQuotaForContext === 'function' && !(await bot.consumeQuotaForContext(ctx))) {
    return true;
  }
  if (typeof bot.runWebSearch === 'function') {
    await bot.runWebSearch(ctx, keyword);
    return true;
  }

  try {
    await ctx.sendChatAction('typing');

    let raw = await executeTool(bot, ctx, 'web_search', { query: keyword }, 'natural_agent_search');

    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error) {
        await bot.refundQuotaForContext?.(ctx);
        await ctx.reply(bot.formatUserFacingError(parsed.message || parsed.error, locale));
        return true;
      }
    } catch {}

    await bot.db.incrementStats('toolCalls');

    if (!hasUsefulToolResult(raw) && looksLikeNewsSearch(keyword)) {
      const fallbackRaw = await fetchNewsFallback(keyword, {
        timeoutMs: bot.config?.requestTimeoutMs
      });
      if (fallbackRaw) raw = fallbackRaw;
    }

    if (!hasUsefulToolResult(raw)) {
      await bot.refundQuotaForContext?.(ctx);
      await ctx.reply(
        locale === 'en'
          ? 'No useful search results were returned. For stable web search, configure BRAVE_SEARCH_API_KEY.'
          : '没有搜到有效结果。如果需要稳定实时搜索，请在 Zeabur 配置 BRAVE_SEARCH_API_KEY。'
      );
      return true;
    }

    const answer = await composeHumanAnswer(bot, ctx, {
      userText: originalText,
      toolName: 'web_search',
      raw,
      title: '联网搜索结果'
    });

    const finalText = appendClickableReferences(answer, raw);
    await replyHtml(ctx, finalText, bot.config.maxOutputChars);
    await rememberHandledInteraction(bot, ctx, originalText, answer, modelName(bot, ctx));
    return true;
  } catch (error) {
    await bot.refundQuotaForContext?.(ctx);
    await ctx.reply(bot.formatUserFacingError(error, locale));
    return true;
  }
}

async function runUrl(bot, ctx, url, originalText = url) {
  const locale = bot.getLocale(ctx);
  const targetUrl = String(url || '').trim();

  if (!/^https?:\/\//i.test(targetUrl)) return false;
  if (typeof bot.consumeQuotaForContext === 'function' && !(await bot.consumeQuotaForContext(ctx))) {
    return true;
  }

  try {
    await ctx.sendChatAction('typing');

    const raw = await executeTool(bot, ctx, 'fetch_url', { url: targetUrl }, 'natural_agent_url');

    try {
      const parsed = JSON.parse(raw);
      if (parsed?.error) {
        await bot.refundQuotaForContext?.(ctx);
        await ctx.reply(locale === 'en' ? 'This page cannot be fetched right now.' : '这个网页暂时抓不到，可能是网站禁止机器人访问。');
        return true;
      }
    } catch {}

    if (!String(raw || '').trim()) {
      await bot.refundQuotaForContext?.(ctx);
      await ctx.reply(
        locale === 'en'
          ? 'This page returned no readable content.'
          : '这个网页没有返回可读取的内容。'
      );
      return true;
    }

    await bot.db.incrementStats('toolCalls');

    const answer = await composeHumanAnswer(bot, ctx, {
      userText: originalText,
      toolName: 'fetch_url',
      raw,
      title: '网页摘要'
    });

    const finalText = appendClickableReferences(answer, raw || JSON.stringify({ results: [{ title: '打开网页', url: targetUrl }] }));
    await replyHtml(ctx, finalText, bot.config.maxOutputChars);
    await rememberHandledInteraction(bot, ctx, originalText, answer, modelName(bot, ctx));
    return true;
  } catch {
    await bot.refundQuotaForContext?.(ctx);
    await ctx.reply(locale === 'en' ? 'This page cannot be fetched right now.' : '这个网页暂时抓不到，可能是网站禁止机器人访问。');
    return true;
  }
}

async function runWeather(bot, ctx, location, originalText = location) {
  const locale = bot.getLocale(ctx);
  const place = String(location || '').trim();

  if (!place) return false;
  if (typeof bot.consumeQuotaForContext === 'function' && !(await bot.consumeQuotaForContext(ctx))) {
    return true;
  }

  try {
    const raw = await executeTool(bot, ctx, 'get_weather', { location: place }, 'natural_agent_weather');
    if (!hasUsefulToolResult(raw)) {
      await bot.refundQuotaForContext?.(ctx);
      await ctx.reply(
        locale === 'en'
          ? 'Weather is not available yet.'
          : '天气服务暂时不可用，请稍后再试。'
      );
      return true;
    }
    await bot.db.incrementStats('toolCalls');

    const answer = await composeHumanAnswer(bot, ctx, {
      userText: originalText,
      toolName: 'get_weather',
      raw,
      title: '天气'
    });

    const finalText = appendClickableReferences(answer, raw);
    await replyHtml(ctx, finalText, bot.config.maxOutputChars);
    await rememberHandledInteraction(bot, ctx, originalText, answer, modelName(bot, ctx));
    return true;
  } catch {
    await bot.refundQuotaForContext?.(ctx);
    if (typeof bot.runWeather === 'function') {
      await bot.runWeather(ctx, place);
      return true;
    }

    await ctx.reply(locale === 'en' ? 'Weather is not available yet.' : '天气功能暂时不可用。');
    return true;
  }
}


function isFollowUpOnly(text = '') {
  return /^(还有吗|还有么|还有没有|继续|接着说|然后呢|那呢|这个呢|它呢|再说点|more|continue)$/i.test(String(text || '').trim());
}

function cleanWeatherLocation(value = '') {
  return String(value || '')
    .replace(/^(今天|明天|后天|今晚|现在|現在|today|tomorrow|tonight|currently)\s*/i, '')
    .replace(/(今天|明天|后天|今晚|现在|現在|today|tomorrow|tonight)$/i, '')
    .replace(/^(in|at|for|the|a|an)\s+/i, '')
    .replace(/(会不会|會不會|是否|有没有|有沒有|会|會|will|is|it|going|to|rain|raining|下雨|有雨|天气|天氣|weather|forecast|气温|氣溫|温度|溫度)/gi, '')
    .replace(/[，。？！?,.!]/g, '')
    .trim();
}

function extractWeatherLocation(text = '') {
  const content = String(text || '').trim();
  if (!/(天气|天氣|下雨|有雨|降雨|气温|氣溫|温度|溫度|weather|forecast|rain|temperature)/i.test(content)) {
    return '';
  }

  const chineseBefore = content.match(/^(?:今天|明天|后天|今晚|现在|現在)?\s*([^，。？！?,.!]{2,40}?)(?:的)?(?:天气|天氣|气温|氣溫|温度|溫度|会不会下雨|會不會下雨|有没有雨|有沒有雨|下雨|有雨)/i);
  const chineseAfter = content.match(/(?:天气|天氣|气温|氣溫|温度|溫度)\s*(?:在|查|查询|查詢|看看)?\s*([^，。？！?,.!]{2,40})/i);
  const englishAfter = content.match(/(?:weather|forecast|rain|temperature)[^a-z0-9]+(?:in|at|for)\s+([a-z0-9\s,.'-]{2,60})/i);
  const englishRain = content.match(/(?:will it rain|is it going to rain)\s+(?:in|at|for)\s+([a-z0-9\s,.'-]{2,60})/i);

  const location = cleanWeatherLocation(
    englishRain?.[1] || englishAfter?.[1] || chineseAfter?.[1] || chineseBefore?.[1] || ''
  );

  if (!location || /^(今天|明天|后天|今晚|现在|現在|weather|rain)$/i.test(location)) return '';
  return location;
}

function looksLikeNewsSearch(text = '') {
  const content = String(text || '').trim();
  if (!content) return false;
  return /新闻|新聞|头条|頭條|热点|熱點|时事|時事|资讯|資訊/i.test(content) ||
    /\bnews\b/i.test(content) ||
    /(?:今天|今日|最近).{0,8}(?:发生|發生)(?:了)?(?:什么|什麼|哪些)?/i.test(content);
}

function looksLikeCurrentSearch(text = '') {
  const content = String(text || '').trim();
  if (!content) return false;

  return /(?:最新|实时|即時|现在的|現在的|今天.*(?:新闻|新聞|消息|热点|熱點|发生|發生)|新闻|新聞|热搜|熱搜|汇率|匯率|股价|股價|价格|價格|金价|金價|油价|油價|current|latest|today.*(?:news|events)|breaking news|exchange rate|stock price|price today)/i.test(content);
}

function normalizeSearchQuery(text = '') {
  return String(text || '')
    .replace(/^(?:帮我|幫我|请|請|麻烦|麻煩|please)\s*/i, '')
    .replace(/^(?:查一下|搜一下|搜索|联网搜索|上网搜|查找|看看|look up|search for|search)\s*/i, '')
    .trim();
}



async function continueFromContext(bot, ctx, text = '') {
  const locale = bot.getLocale(ctx);
  const recentContext = getRecentContext(bot, ctx);

  if (!recentContext) return false;
  if (typeof bot.consumeQuotaForContext === 'function' && !(await bot.consumeQuotaForContext(ctx))) {
    return true;
  }

  const model = modelName(bot, ctx);
  const followupPersonaInstruction = getPersonaInstruction(bot, ctx);

  try {
    await ctx.sendChatAction('typing');

    const completion = await bot.completeWithAiFallback({
      scope: 'follow_up',
      userId: ctx.from?.id,
      preferredProvider: providerId(bot, ctx),
      fallbackEnabled: fallbackEnabled(bot, ctx),
      model,
      locale,
      request: {
        messages: [
          {
            role: 'system',
            content: [
              'You are continuing an existing Telegram conversation.',
              followupPersonaInstruction || 'Persona: default general assistant.',
              'The user is asking a short follow-up such as 还有吗, 继续, 然后呢, 这个呢.',
              'Do not start a new topic.',
              'Use the recent conversation context to continue the same topic.',
              'Answer in Simplified Chinese unless the user clearly uses another language.',
              'Do not invent sources or URLs.',
              'Be natural and concise like ChatGPT.'
            ].join('\n')
          },
          {
            role: 'user',
            content: [
              `Recent conversation context:\n${recentContext}`,
              '',
              `Current follow-up: ${text}`
            ].join('\n')
          }
        ],
        tools: [],
        temperature: 0.3
      }
    });

    const answer = String(completion.result?.text || '').trim();
    if (!answer) return false;

    await replyPlain(ctx, answer, bot.config.maxOutputChars);
    await rememberHandledInteraction(bot, ctx, text, answer, model);
    return true;
  } catch (error) {
    await bot.refundQuotaForContext?.(ctx);
    bot.logger?.warn?.('Follow-up continuation failed', {
      error: bot.formatLogError ? bot.formatLogError(error) : String(error?.message || error)
    });

    return false;
  }
}


async function classifyNaturally(bot, ctx, text) {
  const locale = bot.getLocale(ctx);
  const model = bot.config.routerModel || bot.config.translationModel || bot.config.defaultModel;
  const recentContext = getRecentContext(bot, ctx);

  const prompt = [
    'You are the hidden intent router for a Telegram AI bot.',
    'The user must not need commands.',
    'Use recent context to understand follow-up messages like “继续”, “这个”, “它”, “刚才那个”.',
    'Return JSON only. No Markdown. No explanation.',
    '',
    'Actions: chat, translate, web_search, fetch_url, weather, help.',
    '',
    'Use web_search for latest/current/news/search/prices/exchange rates/recent events/current facts.',
    'Use weather for weather/hot/rain/temperature questions for a place.',
    'Use fetch_url if the user includes a URL.',
    'Use translate when the user asks to translate or rewrite into another language.',
    'If the user asks a follow-up about previous answer, use chat unless fresh information is needed.',
    'If unsure, use chat.',
    '',
    'JSON schema: {"action":"chat|translate|web_search|fetch_url|weather|help","text":"","query":"","url":"","location":"","targetLanguage":"","confidence":0.0}'
  ].join('\n');

  try {
    const completion = await bot.completeWithAiFallback({
      scope: 'router',
      model,
      locale,
      request: {
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: [
              recentContext ? `Recent context:\n${recentContext}\n` : '',
              `Current message: ${text}`
            ].join('\n')
          }
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
    bot.logger?.warn?.('Natural agent router failed; fallback to normal chat', {
      error: bot.formatLogError ? bot.formatLogError(error) : String(error?.message || error)
    });

    return { action: 'chat', confidence: 0 };
  }
}

export async function tryHandleNaturalAgent(bot, ctx) {
  const text = String(ctx.message?.text || '').trim();

  if (!text) return false;
  if (typeof bot.getActiveMode === 'function' && bot.getActiveMode(ctx)) return false;

  // Quoted replies need the main conversation loop so the selected passage,
  // history, memory, and tools remain available together.
  if (getTelegramReplyContext(ctx.message)) return false;

  const locale = bot.getLocale(ctx);

  if (isFollowUpOnly(text)) {
    return continueFromContext(bot, ctx, text);
  }

  const url = text.match(/https?:\/\/[^\s]+/i)?.[0] || '';
  if (url) return runUrl(bot, ctx, url, text);

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
    await bot.runTranslation(ctx, trailingTranslate[1].trim(), bot.normalizeTranslationTarget(trailingTranslate[2]));
    return true;
  }

  const explicitWeather = text.match(/^(?:天气|天氣|查天气|查天氣|weather)\s+(.+)$/i);
  if (explicitWeather) return runWeather(bot, ctx, explicitWeather[1].trim(), text);

  const explicitSearch = text.match(/^(?:搜索|搜一下|联网搜索|上网搜|查一下|web|search)\s+(.+)$/i);
  if (explicitSearch) return runSearch(bot, ctx, explicitSearch[1].trim(), text);

  const weatherLocation = extractWeatherLocation(text);
  if (weatherLocation) return runWeather(bot, ctx, weatherLocation, text);

  if (looksLikeCurrentSearch(text)) {
    return runSearch(bot, ctx, normalizeSearchQuery(text) || text, text);
  }

  if (/^(你能做什么|你会什么|有什么功能|怎么用|帮助|help|what can you do)$/i.test(text)) {
    await bot.handleHelp(ctx);
    return true;
  }

  // Keep only deterministic shortcuts here. Ordinary messages are handled by
  // the main model with conversation history and tools in a single agent loop.
  return false;
}

export const naturalAgentInternals = {
  getPersonaInstruction,
  continueFromContext,
  stripBareUrls,
  stripGeneratedReferences,
  rememberHandledInteraction,
  isFollowUpOnly,
  extractWeatherLocation,
  looksLikeNewsSearch,
  looksLikeCurrentSearch,
  normalizeSearchQuery,
  cleanPlainText,
  getRecentContext,
  hasUsefulToolResult,
  extractReferenceLinks,
  appendClickableReferences,
  rawFallbackText,
  composeHumanAnswer,
  fetchNewsFallback,
  classifyNaturally
};
