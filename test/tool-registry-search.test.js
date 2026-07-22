import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, toolRegistryInternals } from '../src/services/tool-registry.js';
import { naturalAgentInternals } from '../src/services/natural-agent.js';
import { productAgentInternals } from '../src/services/product-agent.js';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createRegistry(overrides = {}, logger = { info() {}, warn() {}, debug() {} }) {
  const config = {
    enableToolCalls: true,
    toolAllowedNames: new Set(['web_search']),
    toolBlockedUserIds: new Set(),
    toolAllowedUserIds: new Set(),
    toolAllowedChatIds: new Set(),
    toolAdminOnlyNames: new Set(),
    toolMaxCallsPerMessage: 4,
    toolUserWindowMs: 60000,
    toolUserMaxCalls: 20,
    networkToolScope: 'all',
    networkToolAllowedUserIds: new Set(),
    networkToolAllowedChatIds: new Set(),
    requestTimeoutMs: 120000,
    ...overrides
  };
  return new ToolRegistry(config, logger);
}

function rejectWhenAborted(signal, callback = () => undefined) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      callback();
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
  });
}

test('web search races DuckDuckGo paths and cancels the slower request', async () => {
  let instantStarted = false;
  let instantAborted = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('html.duckduckgo.com')) {
      return new Response(
        '<a class="result__a" href="https://example.com/story">Fresh result</a>' +
        '<div class="result__snippet">Useful summary</div>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    instantStarted = true;
    return rejectWhenAborted(options.signal, () => { instantAborted = true; });
  };

  const raw = await toolRegistryInternals.searchWeb('fresh topic', { timeoutMs: 1000 });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.results[0].title, 'Fresh result');
  assert.equal(instantStarted, true);
  assert.equal(instantAborted, true);
});

test('web search prefers configured Brave Search and preserves multiple sourced results', async () => {
  let subscriptionToken = '';
  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /api\.search\.brave\.com/);
    subscriptionToken = options.headers['X-Subscription-Token'];
    return new Response(JSON.stringify({
      web: {
        results: [
          { title: 'Fresh story one', url: 'https://example.com/one', description: 'First source', page_age: '2026-07-21T01:00:00Z' },
          { title: 'Fresh story two', url: 'https://example.org/two', description: 'Second source', page_age: '2026-07-21T02:00:00Z' }
        ]
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const raw = await toolRegistryInternals.searchWeb('today topic', {
    timeoutMs: 1000,
    braveApiKey: 'brave-test-key'
  });
  const parsed = JSON.parse(raw);

  assert.equal(subscriptionToken, 'brave-test-key');
  assert.equal(parsed.provider, 'brave');
  assert.equal(parsed.results.length, 2);
  assert.equal(parsed.results[0].url, 'https://example.com/one');
  assert.equal(parsed.results[0].publishedAt, '2026-07-21T01:00:00Z');
});

test('web search falls back to DuckDuckGo when configured Brave Search fails', async () => {
  let braveCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.search.brave.com')) {
      braveCalls += 1;
      return new Response('unavailable', { status: 503 });
    }
    if (String(url).includes('html.duckduckgo.com')) {
      return new Response(
        '<a class="result__a" href="https://example.com/fallback">Fallback result</a>' +
        '<div class="result__snippet">Fallback summary</div>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    return new Response(JSON.stringify({ Heading: '', AbstractText: '', Answer: '', RelatedTopics: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const raw = await toolRegistryInternals.searchWeb('fallback topic', {
    timeoutMs: 1000,
    braveApiKey: 'brave-test-key'
  });
  const parsed = JSON.parse(raw);

  assert.equal(braveCalls, 1);
  assert.equal(parsed.provider, 'duckduckgo');
  assert.equal(parsed.results[0].title, 'Fallback result');
});

test('slow Brave leaves shared search time for DuckDuckGo fallback', async () => {
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('api.search.brave.com')) {
      return rejectWhenAborted(options.signal);
    }
    if (String(url).includes('html.duckduckgo.com')) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return new Response(
        '<a class="result__a" href="https://example.com/after-brave">Fallback after slow Brave</a>' +
        '<div class="result__snippet">Fresh fallback</div>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    return rejectWhenAborted(options.signal);
  };

  const startedAt = Date.now();
  const raw = await toolRegistryInternals.searchWeb('slow brave topic', {
    timeoutMs: 1000,
    braveApiKey: 'brave-test-key'
  });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.provider, 'duckduckgo');
  assert.equal(parsed.results[0].title, 'Fallback after slow Brave');
  assert.ok(Date.now() - startedAt < 800, 'Brave must leave time for the fallback inside one shared budget');
});

test('web search prefers fresh HTML links over a slightly faster Instant Answer', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('html.duckduckgo.com')) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(
        '<a class="result__a" href="https://example.com/fresh">Fresh HTML result</a>' +
        '<div class="result__snippet">Current source</div>',
        { status: 200, headers: { 'content-type': 'text/html' } }
      );
    }
    return new Response(JSON.stringify({
      Heading: 'Generic answer',
      AbstractText: 'Older generic summary',
      Answer: '',
      RelatedTopics: []
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const raw = await toolRegistryInternals.searchWeb('current topic', { timeoutMs: 1000 });
  const parsed = JSON.parse(raw);

  assert.equal(parsed.results[0].title, 'Fresh HTML result');
  assert.equal(parsed.results[0].url, 'https://example.com/fresh');
});

test('web search honors the bounded request timeout from tool context', async () => {
  globalThis.fetch = async (url, options = {}) => rejectWhenAborted(options.signal);
  const registry = createRegistry();
  const startedAt = Date.now();

  const raw = await registry.execute({
    function: { name: 'web_search', arguments: JSON.stringify({ query: 'slow topic' }) }
  }, {
    source: 'test',
    userId: '1',
    requestTimeoutMs: 60,
    toolUsage: { count: 0 }
  });

  assert.equal(JSON.parse(raw).error, 'TOOL_EXECUTION_FAILED');
  assert.ok(Date.now() - startedAt < 500, 'search should stop well before the global 120 second timeout');
});

test('web search honors an external cancellation signal', async () => {
  globalThis.fetch = async (url, options = {}) => rejectWhenAborted(options.signal);
  const controller = new AbortController();
  const pending = toolRegistryInternals.searchWeb('cancel me', {
    signal: controller.signal,
    timeoutMs: 1000
  });

  controller.abort(new DOMException('Superseded', 'AbortError'));
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
});

test('cancelled tool execution does not emit a failure warning', async () => {
  const warnings = [];
  globalThis.fetch = async (url, options = {}) => rejectWhenAborted(options.signal);
  const registry = createRegistry({}, {
    info() {},
    debug() {},
    warn(message) { warnings.push(message); }
  });
  const controller = new AbortController();
  const pending = registry.execute({
    function: { name: 'web_search', arguments: JSON.stringify({ query: 'superseded topic' }) }
  }, {
    source: 'telegram_inline_prefetch',
    userId: '1',
    signal: controller.signal,
    requestTimeoutMs: 1000,
    toolUsage: { count: 0 }
  });

  controller.abort(new DOMException('Superseded', 'AbortError'));
  const raw = JSON.parse(await pending);

  assert.equal(raw.error, 'TOOL_CANCELLED');
  assert.deepEqual(warnings, []);
});

test('Google News RSS fallback is bounded and externally cancellable', async () => {
  globalThis.fetch = async (url, options = {}) => rejectWhenAborted(options.signal);
  const controller = new AbortController();
  const pending = naturalAgentInternals.fetchNewsFallback('today news', {
    signal: controller.signal,
    timeoutMs: 1000
  });

  controller.abort(new DOMException('Superseded', 'AbortError'));
  await assert.rejects(pending, (error) => error?.name === 'AbortError');
});

test('Google News RSS fallback stops at its own timeout', async () => {
  globalThis.fetch = async (url, options = {}) => rejectWhenAborted(options.signal);
  const startedAt = Date.now();

  await assert.rejects(
    naturalAgentInternals.fetchNewsFallback('today news', { timeoutMs: 60 }),
    (error) => error?.name === 'TimeoutError'
  );
  assert.ok(Date.now() - startedAt < 500, 'news fallback should be bounded');
});

test('Google News RSS fallback keeps only local-today stories, sorts them, and preserves sources', async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return new Response(`
      <rss><channel>
        <item>
          <title><![CDATA[Older local-today headline]]></title>
          <link>https://example.com/older-today</link>
          <pubDate><![CDATA[Sun, 12 Jul 2026 23:30:00 GMT]]></pubDate>
          <source url="https://www.apnews.com">AP News</source>
        </item>
        <item>
          <title><![CDATA[Fresh &amp; verified headline]]></title>
          <link>https://example.com/fresh</link>
          <pubDate><![CDATA[Mon, 13 Jul 2026 00:10:00 GMT]]></pubDate>
          <source url="https://www.reuters.com">Reuters</source>
        </item>
        <item>
          <title>Previous local-day headline</title>
          <link>https://example.com/old</link>
          <pubDate>Sun, 12 Jul 2026 15:30:00 GMT</pubDate>
          <source url="https://example.com">Old Source</source>
        </item>
      </channel></rss>
    `, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };

  const naturalResult = JSON.parse(await naturalAgentInternals.fetchNewsFallback('today news', {
    now: Date.parse('2026-07-13T00:30:00.000Z'),
    timeZone: 'Asia/Shanghai',
    region: 'CN',
    language: 'zh-CN'
  }));
  const productResult = await productAgentInternals.fetchNewsFallback('today news');

  assert.match(new URL(requestedUrls[0]).searchParams.get('q'), /when:1d/);
  assert.equal(naturalResult.results.length, 2);
  assert.equal(naturalResult.results[0].title, 'Fresh & verified headline');
  assert.equal(naturalResult.results[0].sourceName, 'Reuters');
  assert.equal(naturalResult.results[0].sourceUrl, 'https://www.reuters.com');
  assert.equal(naturalResult.results[0].publishedAt, '2026-07-13T00:10:00.000Z');
  assert.equal(naturalResult.results[1].title, 'Older local-today headline');
  assert.doesNotMatch(JSON.stringify(naturalResult), /Previous local-day headline/);
  assert.match(productResult, /标题：Fresh & verified headline/);
  assert.doesNotMatch(productResult, /CDATA/);
});

test('Google News freshness uses the configured local year and recognizes today synonyms', async () => {
  globalThis.fetch = async () => new Response(`
    <rss><channel><item>
      <title>Old headline</title>
      <link>https://example.com/old</link>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <source url="https://example.com">Old Source</source>
    </item></channel></rss>
  `, { status: 200, headers: { 'content-type': 'application/rss+xml' } });

  const raw = await naturalAgentInternals.fetchNewsFallback('2026 news', {
    now: Date.parse('2025-12-31T16:30:00.000Z'),
    timeZone: 'Asia/Kuala_Lumpur'
  });

  assert.equal(raw, '');
  assert.equal(naturalAgentInternals.isStrictTodayNewsQuery('当天新闻'), true);
  assert.equal(naturalAgentInternals.isStrictTodayNewsQuery('當日要聞'), true);
});

test('Google News allows explicitly date-scoped history from the current year', async () => {
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(`
      <rss><channel><item>
        <title>January headline</title>
        <link>https://example.com/january</link>
        <pubDate>Thu, 15 Jan 2026 02:00:00 GMT</pubDate>
        <source url="https://example.com">Archive Source</source>
      </item></channel></rss>
    `, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };

  const raw = await naturalAgentInternals.fetchNewsFallback('2026年1月新闻', {
    now: Date.parse('2026-07-16T03:00:00.000Z'),
    timeZone: 'Asia/Shanghai'
  });

  assert.match(raw, /January headline/);
  assert.doesNotMatch(new URL(requestedUrl).searchParams.get('q'), /when:1d/);
  assert.equal(naturalAgentInternals.isDateScopedNewsQuery('上周新闻'), true);
  assert.equal(
    naturalAgentInternals.isDateScopedNewsQuery(
      '2026年7月新闻',
      Date.parse('2026-07-16T03:00:00.000Z'),
      'Asia/Shanghai'
    ),
    true
  );
  assert.equal(
    naturalAgentInternals.isDateScopedNewsQuery(
      '2026年新闻',
      Date.parse('2026-07-16T03:00:00.000Z'),
      'Asia/Shanghai'
    ),
    true
  );
  assert.equal(
    naturalAgentInternals.isDateScopedNewsQuery(
      '2026年7月16日新闻',
      Date.parse('2026-07-16T03:00:00.000Z'),
      'Asia/Shanghai'
    ),
    false
  );
});

test('inline-style news filtering keeps the local day and rejects future timestamps', async () => {
  globalThis.fetch = async () => new Response(`
    <rss><channel>
      <item>
        <title>Today headline</title>
        <link>https://example.com/today</link>
        <pubDate>Thu, 16 Jul 2026 02:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Previous local-day headline</title>
        <link>https://example.com/yesterday</link>
        <pubDate>Wed, 15 Jul 2026 15:30:00 GMT</pubDate>
      </item>
      <item>
        <title>Future headline</title>
        <link>https://example.com/future</link>
        <pubDate>Thu, 16 Jul 2026 03:30:00 GMT</pubDate>
      </item>
    </channel></rss>
  `, { status: 200, headers: { 'content-type': 'application/rss+xml' } });

  const generic = JSON.parse(await naturalAgentInternals.fetchNewsFallback('latest news', {
    now: Date.parse('2026-07-16T03:00:00.000Z'),
    timeZone: 'Asia/Shanghai'
  }));
  const localToday = JSON.parse(await naturalAgentInternals.fetchNewsFallback('latest news', {
    now: Date.parse('2026-07-16T03:00:00.000Z'),
    timeZone: 'Asia/Shanghai',
    todayOnly: true
  }));

  assert.match(JSON.stringify(generic), /Previous local-day headline/);
  assert.doesNotMatch(JSON.stringify(generic), /Future headline/);
  assert.deepEqual(localToday.results.map((item) => item.title), ['Today headline']);
});

test('explicit today intent takes precedence over years mentioned as the news topic', async () => {
  globalThis.fetch = async () => new Response(`
    <rss><channel>
      <item>
        <title>Today article discussing 2025</title>
        <link>https://example.com/today-about-2025</link>
        <pubDate>Thu, 16 Jul 2026 02:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Old article published in 2025</title>
        <link>https://example.com/old-2025</link>
        <pubDate>Wed, 16 Jul 2025 02:00:00 GMT</pubDate>
      </item>
    </channel></rss>
  `, { status: 200, headers: { 'content-type': 'application/rss+xml' } });

  const result = JSON.parse(await naturalAgentInternals.fetchNewsFallback('今天关于2025年的新闻', {
    now: Date.parse('2026-07-16T03:00:00.000Z'),
    timeZone: 'Asia/Shanghai'
  }));

  assert.equal(result.freshOnly, true);
  assert.equal(result.strictToday, true);
  assert.deepEqual(result.results.map((item) => item.title), ['Today article discussing 2025']);
});

test('Google News requests the traditional Chinese feed for traditional locales', async () => {
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(`
      <rss><channel><item>
        <title>今日新聞</title>
        <link>https://example.com/today</link>
        <pubDate>Thu, 16 Jul 2026 02:00:00 GMT</pubDate>
        <source url="https://example.com">新聞來源</source>
      </item></channel></rss>
    `, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };

  await naturalAgentInternals.fetchNewsFallback('今日新聞', {
    now: Date.parse('2026-07-16T03:00:00.000Z'),
    timeZone: 'Asia/Taipei',
    region: 'TW',
    language: 'zh-TW'
  });

  assert.equal(new URL(requestedUrl).searchParams.get('ceid'), 'TW:zh-Hant');
});
