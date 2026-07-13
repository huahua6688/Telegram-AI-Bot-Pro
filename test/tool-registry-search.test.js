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

test('Google News RSS fallbacks unwrap CDATA titles and dates', async () => {
  globalThis.fetch = async () => new Response(`
    <rss><channel><item>
      <title><![CDATA[Fresh &amp; verified headline]]></title>
      <link>https://example.com/fresh</link>
      <pubDate><![CDATA[Mon, 13 Jul 2026 03:00:00 GMT]]></pubDate>
    </item></channel></rss>
  `, { status: 200, headers: { 'content-type': 'application/rss+xml' } });

  const naturalResult = JSON.parse(await naturalAgentInternals.fetchNewsFallback('today news'));
  const productResult = await productAgentInternals.fetchNewsFallback('today news');

  assert.equal(naturalResult.results[0].title, 'Fresh & verified headline');
  assert.equal(naturalResult.results[0].description, 'Mon, 13 Jul 2026 03:00:00 GMT');
  assert.match(productResult, /标题：Fresh & verified headline/);
  assert.doesNotMatch(productResult, /CDATA/);
});
