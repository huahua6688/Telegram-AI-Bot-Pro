import http from 'node:http';

const MINI_APP_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="light dark" />
  <title>Xiomn Bot 控制台</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--tg-theme-text-color, #111827);
      background: var(--tg-theme-bg-color, #f3f4f6);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      padding:
        max(18px, env(safe-area-inset-top))
        16px
        max(24px, env(safe-area-inset-bottom));
      background: var(--tg-theme-bg-color, #f3f4f6);
      color: var(--tg-theme-text-color, #111827);
    }

    .shell {
      width: min(100%, 620px);
      margin: 0 auto;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .12em;
    }

    h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.15;
    }

    .lead {
      margin: 10px 0 22px;
      color: var(--tg-theme-hint-color, #6b7280);
      line-height: 1.6;
    }

    .card {
      margin-top: 14px;
      padding: 18px;
      border-radius: 18px;
      background: var(--tg-theme-secondary-bg-color, #ffffff);
      box-shadow: 0 8px 30px rgba(0, 0, 0, .06);
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid rgba(127, 127, 127, .18);
    }

    .status-row:last-child { border-bottom: 0; }

    .label {
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 14px;
    }

    .value {
      max-width: 66%;
      text-align: right;
      font-weight: 700;
      word-break: break-word;
    }

    .online {
      color: #16a34a;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 18px;
    }

    button {
      width: 100%;
      min-height: 48px;
      border: 0;
      border-radius: 14px;
      padding: 12px 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .primary {
      color: var(--tg-theme-button-text-color, #ffffff);
      background: var(--tg-theme-button-color, #2481cc);
    }

    .secondary {
      color: var(--tg-theme-text-color, #111827);
      background: var(--tg-theme-secondary-bg-color, #ffffff);
    }

    .error {
      color: var(--tg-theme-destructive-text-color, #dc2626);
    }

    .small {
      margin-top: 16px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
      line-height: 1.5;
      text-align: center;
    }
  </style>
</head>
<body>
  <main class="shell">
    <p class="eyebrow">PROJECT XIOMN</p>
    <h1>Xiomn Bot 控制台</h1>
    <p class="lead" id="welcome">正在连接 Telegram 和 Bot 服务……</p>

    <section class="card">
      <div class="status-row">
        <span class="label">服务状态</span>
        <span class="value" id="serviceStatus">检查中</span>
      </div>
      <div class="status-row">
        <span class="label">AI Provider</span>
        <span class="value" id="provider">—</span>
      </div>
      <div class="status-row">
        <span class="label">默认模型</span>
        <span class="value" id="model">—</span>
      </div>
      <div class="status-row">
        <span class="label">运行时间</span>
        <span class="value" id="uptime">—</span>
      </div>
      <div class="status-row">
        <span class="label">已处理消息</span>
        <span class="value" id="messages">—</span>
      </div>
      <div class="status-row">
        <span class="label">AI 调用</span>
        <span class="value" id="aiCalls">—</span>
      </div>
    </section>

    <div class="actions">
      <button class="primary" id="refreshButton" type="button">刷新状态</button>
      <button class="secondary" id="closeButton" type="button">关闭</button>
    </div>

    <p class="small">
      第一版先提供状态面板。模型选择、语音设置和管理功能将在确认 Mini App 正常打开后接入。
    </p>
  </main>

  <script>
    const tg = window.Telegram && window.Telegram.WebApp
      ? window.Telegram.WebApp
      : null;

    const elements = {
      welcome: document.getElementById('welcome'),
      serviceStatus: document.getElementById('serviceStatus'),
      provider: document.getElementById('provider'),
      model: document.getElementById('model'),
      uptime: document.getElementById('uptime'),
      messages: document.getElementById('messages'),
      aiCalls: document.getElementById('aiCalls'),
      refreshButton: document.getElementById('refreshButton'),
      closeButton: document.getElementById('closeButton')
    };

    function formatUptime(seconds) {
      const total = Number(seconds || 0);
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);

      if (days > 0) return days + ' 天 ' + hours + ' 小时';
      if (hours > 0) return hours + ' 小时 ' + minutes + ' 分钟';
      return minutes + ' 分钟';
    }

    function setupTelegram() {
      if (!tg) {
        elements.welcome.textContent = '当前在普通浏览器中打开。进入 Telegram 后会显示用户信息。';
        return;
      }

      tg.ready();
      tg.expand();

      const user = tg.initDataUnsafe && tg.initDataUnsafe.user
        ? tg.initDataUnsafe.user
        : null;

      const name = user
        ? [user.first_name, user.last_name].filter(Boolean).join(' ')
        : '';

      elements.welcome.textContent = name
        ? '你好，' + name + '。这里是你的 Bot 控制台。'
        : '已在 Telegram 中打开 Bot 控制台。';
    }

    async function loadStatus() {
      elements.refreshButton.disabled = true;
      elements.refreshButton.textContent = '刷新中…';
      elements.serviceStatus.className = 'value';
      elements.serviceStatus.textContent = '检查中';

      try {
        const response = await fetch('/health', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }

        const data = await response.json();
        const stats = data.stats || {};

        elements.serviceStatus.textContent = data.ok ? '在线' : '异常';
        elements.serviceStatus.className = data.ok ? 'value online' : 'value error';
        elements.provider.textContent = data.provider || '未配置';
        elements.model.textContent = data.model || '未配置';
        elements.uptime.textContent = formatUptime(data.uptime);
        elements.messages.textContent = String(stats.messagesHandled ?? 0);
        elements.aiCalls.textContent = String(stats.aiCalls ?? 0);
      } catch (error) {
        elements.serviceStatus.textContent = '连接失败';
        elements.serviceStatus.className = 'value error';
        elements.provider.textContent = '—';
        elements.model.textContent = '—';
        elements.uptime.textContent = '—';
        elements.messages.textContent = '—';
        elements.aiCalls.textContent = '—';
      } finally {
        elements.refreshButton.disabled = false;
        elements.refreshButton.textContent = '刷新状态';
      }
    }

    elements.refreshButton.addEventListener('click', loadStatus);
    elements.closeButton.addEventListener('click', () => {
      if (tg) {
        tg.close();
      } else {
        window.history.back();
      }
    });

    setupTelegram();
    loadStatus();
  </script>
</body>
</html>`;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://telegram.org",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self' data: https:"
    ].join('; ')
  });
  res.end(html);
}

function buildHealthPayload({ db, config }) {
  const stats = db.getStats();

  return {
    ok: true,
    service: 'telegram-ai-bot-pro',
    provider: config.aiProvider,
    model: config.defaultModel,
    translationModel: config.translationModel,
    routerModel: config.routerModel,
    availableModels: config.availableModels || [],
    aiRouter: config.enableAiRouter ? config.aiRouterMode || 'smart' : 'off',
    memorySummaryInterval: config.memorySummaryInterval,
    uptime: Math.round(process.uptime()),
    stats
  };
}

export function startHealthServer({ port, db, config, logger }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/app' || pathname === '/app/') {
      sendHtml(res, 200, MINI_APP_HTML);
      return;
    }

    if (pathname === '/' || pathname === '/health') {
      try {
        sendJson(res, 200, buildHealthPayload({ db, config }));
      } catch (error) {
        logger.error('Health check failed', { error: error.message });
        sendJson(res, 500, {
          ok: false,
          error: 'HEALTH_CHECK_FAILED'
        });
      }
      return;
    }

    if (pathname === '/ready') {
      try {
        db.getStats();
        sendJson(res, 200, {
          ok: true,
          ready: true,
          service: 'telegram-ai-bot-pro'
        });
      } catch (error) {
        logger.error('Readiness check failed', { error: error.message });
        sendJson(res, 503, {
          ok: false,
          ready: false,
          error: 'NOT_READY'
        });
      }
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: 'NOT_FOUND',
      availableRoutes: ['/', '/app', '/health', '/ready']
    });
  });

  server.listen(port, () => {
    logger.info(`Health server listening on :${port}`, {
      routes: ['/', '/app', '/health', '/ready']
    });
  });

  return server;
}
