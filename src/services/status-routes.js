import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

function sendJson(res, statusCode, payload) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"
  });
  res.end(html);
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function getBuildInfo() {
  const version = firstNonEmpty(
    process.env.APP_VERSION,
    process.env.npm_package_version,
    packageJson.version,
    'unknown'
  );
  const revision = firstNonEmpty(
    process.env.GIT_COMMIT_SHA,
    process.env.ZEABUR_GIT_COMMIT_SHA,
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.RENDER_GIT_COMMIT,
    process.env.SOURCE_VERSION,
    process.env.COMMIT_SHA
  );

  return {
    version,
    revision,
    shortRevision: revision ? revision.slice(0, 12) : ''
  };
}

function providerSupports(providerManager, capability, preferredProvider = '') {
  try {
    if (typeof providerManager?.hasAvailableProvider !== 'function') return false;
    return Boolean(providerManager.hasAvailableProvider(capability, preferredProvider));
  } catch {
    return false;
  }
}

const CAPABILITY_STATUS = Object.freeze({
  READY: 'ready',
  DEGRADED: 'degraded',
  UNCONFIGURED: 'unconfigured',
  UNSUPPORTED: 'unsupported'
});

function capabilityDetail(status, {
  available = status === CAPABILITY_STATUS.READY || status === CAPABILITY_STATUS.DEGRADED,
  enabled = true,
  provider = '',
  reason = ''
} = {}) {
  return {
    status,
    available: Boolean(available),
    enabled: Boolean(enabled),
    provider: String(provider || ''),
    reason: String(reason || '')
  };
}

function normalizeProviderId(providerId = '') {
  return String(providerId || '').trim().toLowerCase();
}

function listProviderRows(providerManager) {
  try {
    if (typeof providerManager?.listProviders !== 'function') return [];
    const rows = providerManager.listProviders();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function selectProvider(providerManager, capability, preferredProvider, fallbackEnabled) {
  try {
    if (typeof providerManager?.selectProvider === 'function') {
      return providerManager.selectProvider({
        capability,
        preferredProvider,
        fallbackEnabled
      });
    }
  } catch {
    return null;
  }

  if (fallbackEnabled && providerSupports(providerManager, capability, preferredProvider)) {
    return { providerId: normalizeProviderId(preferredProvider) };
  }

  return null;
}

function providerCapabilityDetail(
  providerManager,
  capability,
  preferredProvider = '',
  { fallbackEnabled = true } = {}
) {
  const preferred = normalizeProviderId(preferredProvider);
  const selected = selectProvider(
    providerManager,
    capability,
    preferredProvider,
    fallbackEnabled
  );

  if (selected) {
    const selectedProvider = normalizeProviderId(selected.providerId);
    const usingFallback = Boolean(
      fallbackEnabled &&
      preferred &&
      preferred !== 'auto' &&
      selectedProvider &&
      selectedProvider !== preferred
    );
    return capabilityDetail(
      usingFallback ? CAPABILITY_STATUS.DEGRADED : CAPABILITY_STATUS.READY,
      {
        available: true,
        provider: selectedProvider || preferred,
        reason: usingFallback ? 'fallback_provider' : ''
      }
    );
  }

  const rows = listProviderRows(providerManager);
  if (rows.length === 0) {
    return capabilityDetail(CAPABILITY_STATUS.UNCONFIGURED, {
      available: false,
      provider: preferred,
      reason: 'provider_status_unavailable'
    });
  }

  const supported = rows.filter((row) => Boolean(row?.capabilities?.[capability]));
  if (supported.length === 0) {
    return capabilityDetail(CAPABILITY_STATUS.UNSUPPORTED, {
      available: false,
      provider: preferred,
      reason: 'provider_capability_unsupported'
    });
  }

  const configured = supported.filter((row) => row?.configured && row?.enabled !== false);
  if (configured.length > 0) {
    return capabilityDetail(CAPABILITY_STATUS.DEGRADED, {
      available: false,
      provider: preferred || configured[0]?.id,
      reason: 'configured_provider_unavailable'
    });
  }

  return capabilityDetail(CAPABILITY_STATUS.UNCONFIGURED, {
    available: false,
    provider: preferred,
    reason: supported.some((row) => row?.enabled === false)
      ? 'provider_disabled'
      : 'provider_key_missing'
  });
}

function toolIsAllowed(config, toolName) {
  const allowed = config?.toolAllowedNames;
  if (allowed === undefined || allowed === null) return true;
  if (typeof allowed.has === 'function') return allowed.has(toolName);
  if (Array.isArray(allowed)) return allowed.includes(toolName);
  return String(allowed)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(toolName);
}

function supportsGeminiGoogleSearch(model = '') {
  const normalized = String(model || '').trim().toLowerCase();
  const major = Number(normalized.match(/^gemini-(\d+)(?:\.|[-_])/)?.[1] || 0);
  if (major >= 3) return true;
  if (/^gemini-2\.0-flash(?:$|-)/.test(normalized)) return true;
  return (
    /^gemini-2\.5-(?:pro|flash|flash-lite)(?:$|-)/.test(normalized) &&
    !/(?:image|tts|native-audio|live)/.test(normalized)
  );
}

function configuredGeminiSearchModel(config) {
  const models = [
    ...(Array.isArray(config?.providerModels?.gemini) ? config.providerModels.gemini : []),
    config?.providerDefaultModels?.gemini,
    normalizeProviderId(config?.aiProvider) === 'gemini' ? config?.defaultModel : ''
  ];
  return models.find((model) => supportsGeminiGoogleSearch(model)) || '';
}

function webSearchCapabilityDetail({ config, providerManager }) {
  const enabled = Boolean(config?.enableToolCalls && config?.enableWebSearch);
  if (!enabled) {
    return capabilityDetail(CAPABILITY_STATUS.UNSUPPORTED, {
      available: false,
      enabled: false,
      reason: 'feature_disabled'
    });
  }

  if (!toolIsAllowed(config, 'web_search')) {
    return capabilityDetail(CAPABILITY_STATUS.UNCONFIGURED, {
      available: false,
      reason: 'web_search_tool_not_allowed'
    });
  }

  if (String(config?.braveSearchApiKey || '').trim()) {
    return capabilityDetail(CAPABILITY_STATUS.READY, {
      provider: 'brave'
    });
  }

  const geminiModel = configuredGeminiSearchModel(config);
  if (config?.enableGeminiGoogleSearch && geminiModel) {
    const gemini = providerCapabilityDetail(
      providerManager,
      'chat',
      'gemini',
      { fallbackEnabled: false }
    );
    if (gemini.status === CAPABILITY_STATUS.READY && gemini.available) {
      return capabilityDetail(CAPABILITY_STATUS.READY, {
        provider: 'gemini-google-search'
      });
    }
  }

  // The application has a keyless DuckDuckGo HTML/Instant Answer fallback.
  // It is usable, but it cannot offer the reliability of a configured search
  // API and should never be advertised as fully ready.
  return capabilityDetail(CAPABILITY_STATUS.DEGRADED, {
    available: true,
    provider: 'duckduckgo',
    reason: 'keyless_search_fallback'
  });
}

export function buildCapabilityDetails({ config, providerManager }) {
  return {
    webSearch: webSearchCapabilityDetail({ config, providerManager }),
    vision: providerCapabilityDetail(providerManager, 'vision', config?.visionProvider),
    imageGeneration: providerCapabilityDetail(
      providerManager,
      'imageGeneration',
      config?.imageProvider
    ),
    imageEditing: providerCapabilityDetail(
      providerManager,
      'imageEditing',
      config?.imageProvider
    ),
    speechTranscription: providerCapabilityDetail(
      providerManager,
      'speechTranscription',
      config?.transcriptionProvider
    ),
    speechSynthesis: providerCapabilityDetail(
      providerManager,
      'speechSynthesis',
      config?.ttsProvider
    ),
    // Telegram's current "live" entry is a placeholder around transcription
    // and TTS. It is not an end-to-end, bidirectional live audio session yet.
    liveAudio: capabilityDetail(CAPABILITY_STATUS.UNSUPPORTED, {
      available: false,
      enabled: Boolean(config?.enableLiveAudio),
      provider: 'gemini-live',
      reason: 'telegram_live_audio_not_implemented'
    }),
    liveTranslate: capabilityDetail(CAPABILITY_STATUS.UNSUPPORTED, {
      available: false,
      enabled: Boolean(config?.enableLiveTranslate),
      provider: 'gemini-live',
      reason: 'telegram_live_translate_not_implemented'
    }),
    // Credits can be sold independently, but Telegram video bytes are not
    // currently passed to any model pipeline.
    video: capabilityDetail(CAPABILITY_STATUS.UNSUPPORTED, {
      available: false,
      enabled: Boolean(config?.enableVideo),
      reason: 'telegram_video_pipeline_not_implemented'
    })
  };
}

export function buildCapabilities(
  { db, config, bot, providerManager },
  capabilityDetails = buildCapabilityDetails({ config, providerManager })
) {
  return {
    chat: providerSupports(providerManager, 'chat', config.aiProvider) || Boolean(bot),
    privacyChat: Boolean(bot?.privacyConfig),
    databaseEncryption: Boolean(db?.chatEncryption?.enabled),
    providerFallback: Boolean(config.enableProviderFallback),
    toolCalls: Boolean(config.enableToolCalls),
    webSearch: capabilityDetails.webSearch.available,
    urlFetch: Boolean(config.enableToolCalls && config.enableUrlFetch),
    memorySummary: Boolean(config.enableMemorySummary),
    fileParsing: true,
    vision: capabilityDetails.vision.available,
    imageGeneration: capabilityDetails.imageGeneration.available,
    imageEditing: capabilityDetails.imageEditing.available,
    speechTranscription: capabilityDetails.speechTranscription.available,
    speechSynthesis: capabilityDetails.speechSynthesis.available,
    liveAudio: capabilityDetails.liveAudio.available,
    liveTranslate: capabilityDetails.liveTranslate.available,
    video: capabilityDetails.video.available
  };
}

export function buildHealthPayload(context) {
  const { db, config } = context;
  const stats = db.getStats();
  const build = getBuildInfo();
  const capabilityDetails = buildCapabilityDetails(context);
  const capabilityStatuses = Object.fromEntries(
    Object.entries(capabilityDetails).map(([name, detail]) => [name, detail.status])
  );
  const capabilities = buildCapabilities(context, capabilityDetails);

  return {
    ok: true,
    online: true,
    service: 'telegram-ai-bot-pro',
    version: build.version,
    revision: build.revision,
    shortRevision: build.shortRevision,
    provider: config.aiProvider,
    model: config.defaultModel,
    translationModel: config.translationModel,
    routerModel: config.routerModel,
    availableModels: config.availableModels || [],
    aiRouter: config.enableAiRouter ? config.aiRouterMode || 'smart' : 'off',
    memorySummaryInterval: config.memorySummaryInterval,
    uptime: Math.round(process.uptime()),
    encryption: {
      enabled: Boolean(db?.chatEncryption?.enabled),
      version: String(db?.chatEncryption?.version || '')
    },
    capabilities,
    capabilityStatuses,
    capabilityDetails,
    enabledCapabilities: Object.entries(capabilities)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
    stats
  };
}

const STATUS_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>Xiomn Bot 状态</title>
  <style>
    :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color-scheme: light dark; }
    body { margin: 0; background: #f3f4f6; color: #111827; }
    main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
    h1 { margin: 0; font-size: 30px; }
    .sub { margin: 8px 0 22px; color: #6b7280; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; }
    .card { background: #fff; border-radius: 18px; padding: 18px; box-shadow: 0 8px 30px rgba(0,0,0,.06); }
    .row { display: flex; justify-content: space-between; gap: 18px; padding: 9px 0; border-bottom: 1px solid #e5e7eb; }
    .row:last-child { border-bottom: 0; }
    .label { color: #6b7280; }
    .value { text-align: right; font-weight: 700; word-break: break-word; }
    .online { color: #15803d; }
    .caps { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 12px; }
    .cap { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 11px 12px; border-radius: 13px; background: #f9fafb; }
    .pill { padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 800; }
    .on { color: #166534; background: #dcfce7; }
    .off { color: #6b7280; background: #e5e7eb; }
    .degraded { color: #92400e; background: #fef3c7; }
    .unsupported { color: #991b1b; background: #fee2e2; }
    .wide { grid-column: 1 / -1; }
    button { margin-top: 16px; border: 0; border-radius: 12px; padding: 11px 15px; font: inherit; font-weight: 800; cursor: pointer; color: #fff; background: #2563eb; }
    .error { color: #b91c1c; }
    @media (prefers-color-scheme: dark) {
      body { background: #111827; color: #f9fafb; }
      .card { background: #1f2937; }
      .sub, .label { color: #9ca3af; }
      .row { border-color: #374151; }
      .cap { background: #111827; }
      .off { color: #d1d5db; background: #374151; }
      .degraded { color: #fde68a; background: #78350f; }
      .unsupported { color: #fecaca; background: #7f1d1d; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Xiomn Bot 状态</h1>
    <p class="sub" id="updated">正在读取服务状态……</p>

    <div class="grid">
      <section class="card">
        <h2>运行信息</h2>
        <div class="row"><span class="label">状态</span><span class="value online" id="online">检查中</span></div>
        <div class="row"><span class="label">应用版本</span><span class="value" id="version">—</span></div>
        <div class="row"><span class="label">Git 版本</span><span class="value" id="revision">—</span></div>
        <div class="row"><span class="label">运行时间</span><span class="value" id="uptime">—</span></div>
      </section>

      <section class="card">
        <h2>AI 配置</h2>
        <div class="row"><span class="label">Provider</span><span class="value" id="provider">—</span></div>
        <div class="row"><span class="label">默认模型</span><span class="value" id="model">—</span></div>
        <div class="row"><span class="label">已处理消息</span><span class="value" id="messages">—</span></div>
        <div class="row"><span class="label">AI 调用</span><span class="value" id="aiCalls">—</span></div>
      </section>

      <section class="card wide">
        <h2>已启用能力</h2>
        <div class="caps" id="capabilities"></div>
        <button id="refresh" type="button">刷新状态</button>
      </section>
    </div>
  </main>

  <script>
    const labels = {
      chat: '普通聊天', privacyChat: '隐私聊天', databaseEncryption: '数据库加密',
      providerFallback: '备用 Provider', toolCalls: '工具调用', webSearch: '联网搜索',
      urlFetch: '网页读取', memorySummary: '长期记忆总结', fileParsing: '文件解析',
      vision: '图片识别', imageGeneration: '图片生成', imageEditing: '图片编辑',
      speechTranscription: '语音转文字', speechSynthesis: '文字转语音',
      liveAudio: '实时语音', liveTranslate: '实时翻译', video: '视频理解'
    };

    const statusLabels = {
      ready: '就绪',
      degraded: '服务降级',
      unconfigured: '未配置',
      unsupported: '暂不支持'
    };

    function formatUptime(seconds) {
      const value = Math.max(0, Number(seconds || 0));
      const days = Math.floor(value / 86400);
      const hours = Math.floor((value % 86400) / 3600);
      const minutes = Math.floor((value % 3600) / 60);
      return [days ? days + ' 天' : '', hours ? hours + ' 小时' : '', minutes + ' 分钟'].filter(Boolean).join(' ');
    }

    function renderCapabilities(items, statuses) {
      const root = document.getElementById('capabilities');
      root.innerHTML = '';
      Object.entries(items || {}).forEach(function ([key, enabled]) {
        const item = document.createElement('div');
        const name = document.createElement('span');
        const state = document.createElement('span');
        const status = statuses?.[key] || (enabled ? 'ready' : 'unconfigured');
        item.className = 'cap';
        name.textContent = labels[key] || key;
        state.className = 'pill ' + (
          status === 'ready'
            ? 'on'
            : status === 'degraded'
              ? 'degraded'
              : status === 'unsupported'
                ? 'unsupported'
                : 'off'
        );
        state.textContent = statusLabels[status] || status;
        item.appendChild(name);
        item.appendChild(state);
        root.appendChild(item);
      });
    }

    async function load() {
      const updated = document.getElementById('updated');
      try {
        const response = await fetch('/health', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || '状态读取失败');
        document.getElementById('online').textContent = '在线';
        document.getElementById('version').textContent = data.version || '未知';
        document.getElementById('revision').textContent = data.shortRevision || '未提供';
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('provider').textContent = data.provider || '—';
        document.getElementById('model').textContent = data.model || '—';
        document.getElementById('messages').textContent = String(data.stats?.messagesHandled || 0);
        document.getElementById('aiCalls').textContent = String(data.stats?.aiCalls || 0);
        renderCapabilities(data.capabilities || {}, data.capabilityStatuses || {});
        updated.className = 'sub';
        updated.textContent = '最后更新：' + new Date().toLocaleString();
      } catch (error) {
        document.getElementById('online').textContent = '异常';
        updated.className = 'sub error';
        updated.textContent = error.message || '无法读取服务状态';
      }
    }

    document.getElementById('refresh').addEventListener('click', load);
    load();
    setInterval(load, 60000);
  </script>
</body>
</html>`;

export function installEnhancedStatusRoutes({ server, db, config, bot, providerManager, logger }) {
  if (!server || typeof server.listeners !== 'function') {
    throw new Error('STATUS_SERVER_REQUIRED');
  }

  const previousListeners = server.listeners('request');
  if (previousListeners.length === 0) {
    throw new Error('STATUS_SERVER_REQUEST_HANDLER_MISSING');
  }

  for (const listener of previousListeners) {
    server.removeListener('request', listener);
  }

  const context = { db, config, bot, providerManager };

  server.on('request', (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if ((url.pathname === '/status' || url.pathname === '/status/') && req.method === 'GET') {
      sendHtml(res, 200, STATUS_HTML);
      return;
    }

    if ((url.pathname === '/' || url.pathname === '/health') && req.method === 'GET') {
      try {
        sendJson(res, 200, buildHealthPayload(context));
      } catch (error) {
        logger?.error?.('Enhanced health check failed', { error: error.message });
        sendJson(res, 500, { ok: false, error: 'HEALTH_CHECK_FAILED' });
      }
      return;
    }

    if (url.pathname === '/ready' && req.method === 'GET') {
      try {
        db.getStats();
        const build = getBuildInfo();
        sendJson(res, 200, {
          ok: true,
          ready: true,
          service: 'telegram-ai-bot-pro',
          version: build.version,
          revision: build.revision,
          database: 'ready',
          encryption: Boolean(db?.chatEncryption?.enabled)
        });
      } catch (error) {
        logger?.error?.('Enhanced readiness check failed', { error: error.message });
        sendJson(res, 503, {
          ok: false,
          ready: false,
          error: 'NOT_READY'
        });
      }
      return;
    }

    for (const listener of previousListeners) {
      listener.call(server, req, res);
    }
  });

  logger?.info?.('Enhanced status routes installed', {
    routes: ['/status', '/health', '/ready']
  });

  return server;
}
