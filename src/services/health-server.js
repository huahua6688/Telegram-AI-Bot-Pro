import crypto from 'node:crypto';
import http from 'node:http';

const TELEGRAM_AUTH_MAX_AGE_SECONDS = 60 * 60;
const MAX_JSON_BODY_BYTES = 32 * 1024;

const PROVIDER_LABELS = {
  auto: '自动选择',
  gemini: 'Google Gemini',
  'gemini-live': 'Gemini Live',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  'github-models': 'GitHub Models',
  huggingface: 'Hugging Face',
  mistral: 'Mistral',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI Compatible',
  anthropic: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  grok: 'xAI Grok',
  glm: '智谱 GLM',
  doubao: '豆包'
};

const PROVIDER_ORDER = [
  'auto',
  'gemini',
  'gemini-live',
  'groq',
  'openrouter',
  'github-models',
  'huggingface',
  'mistral',
  'openai',
  'openai-compatible',
  'anthropic',
  'deepseek',
  'qwen',
  'grok',
  'glm',
  'doubao'
];

const LANGUAGE_OPTIONS = [
  { id: 'auto', label: '跟随 Telegram' },
  { id: 'zh', label: '简体中文' },
  { id: 'zh-hant', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'km', label: 'ភាសាខ្មែរ' },
  { id: 'ms', label: 'Bahasa Melayu' },
  { id: 'id', label: 'Bahasa Indonesia' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'th', label: 'ไทย' },
  { id: 'vi', label: 'Tiếng Việt' }
];

const PERSONA_OPTIONS = [
  { id: 'default', label: '默认助手' },
  { id: 'coder', label: '编程专家' },
  { id: 'translator', label: '翻译助手' },
  { id: 'teacher', label: '耐心老师' },
  { id: 'writer', label: '写作助手' }
];

const MINI_APP_HTML = String.raw`<!doctype html>
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
        max(28px, env(safe-area-inset-bottom));
      background: var(--tg-theme-bg-color, #f3f4f6);
      color: var(--tg-theme-text-color, #111827);
    }

    .shell {
      width: min(100%, 640px);
      margin: 0 auto;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .12em;
    }

    h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.15;
    }

    h2 {
      margin: 0;
      font-size: 18px;
    }

    .lead {
      margin: 10px 0 22px;
      color: var(--tg-theme-hint-color, #6b7280);
      line-height: 1.55;
    }

    .card {
      margin-top: 14px;
      padding: 18px;
      border-radius: 18px;
      background: var(--tg-theme-secondary-bg-color, #ffffff);
      box-shadow: 0 8px 30px rgba(0, 0, 0, .06);
    }

    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }

    .badge {
      padding: 5px 9px;
      border-radius: 999px;
      color: #15803d;
      background: rgba(22, 163, 74, .12);
      font-size: 12px;
      font-weight: 800;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 11px 0;
      border-bottom: 1px solid rgba(127, 127, 127, .18);
    }

    .status-row:last-child { border-bottom: 0; }

    .label {
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 14px;
    }

    .value {
      max-width: 68%;
      text-align: right;
      font-weight: 700;
      word-break: break-word;
    }

    .online { color: #16a34a; }
    .error { color: var(--tg-theme-destructive-text-color, #dc2626); }

    .field {
      margin-top: 15px;
    }

    .field label {
      display: block;
      margin-bottom: 7px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 13px;
      font-weight: 700;
    }

    select {
      width: 100%;
      min-height: 48px;
      padding: 0 12px;
      border: 1px solid rgba(127, 127, 127, .25);
      border-radius: 13px;
      color: var(--tg-theme-text-color, #111827);
      background: var(--tg-theme-bg-color, #f9fafb);
      font: inherit;
      outline: none;
    }

    select:focus {
      border-color: var(--tg-theme-button-color, #2481cc);
    }

    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-top: 17px;
    }

    .switch-copy strong {
      display: block;
      font-size: 15px;
    }

    .switch-copy span {
      display: block;
      margin-top: 3px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
      line-height: 1.4;
    }

    .switch {
      position: relative;
      flex: 0 0 auto;
      width: 50px;
      height: 30px;
    }

    .switch input {
      width: 0;
      height: 0;
      opacity: 0;
    }

    .slider {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      background: rgba(127, 127, 127, .32);
      transition: .2s;
    }

    .slider::before {
      content: "";
      position: absolute;
      width: 24px;
      height: 24px;
      left: 3px;
      top: 3px;
      border-radius: 50%;
      background: white;
      box-shadow: 0 2px 7px rgba(0,0,0,.18);
      transition: .2s;
    }

    .switch input:checked + .slider {
      background: var(--tg-theme-button-color, #2481cc);
    }

    .switch input:checked + .slider::before {
      transform: translateX(20px);
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
      font-weight: 800;
      cursor: pointer;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: .55;
    }

    .primary {
      color: var(--tg-theme-button-text-color, #ffffff);
      background: var(--tg-theme-button-color, #2481cc);
    }

    .secondary {
      color: var(--tg-theme-text-color, #111827);
      background: var(--tg-theme-secondary-bg-color, #ffffff);
    }

    .notice {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 12px;
      color: var(--tg-theme-hint-color, #6b7280);
      background: rgba(127, 127, 127, .1);
      font-size: 13px;
      line-height: 1.5;
    }

    .notice.success {
      color: #166534;
      background: rgba(22, 163, 74, .12);
    }

    .notice.failure {
      color: var(--tg-theme-destructive-text-color, #dc2626);
      background: rgba(220, 38, 38, .1);
    }

    .hidden { display: none; }

    .small {
      margin-top: 18px;
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
      <div class="section-head">
        <h2>运行状态</h2>
        <span class="badge" id="statusBadge">检查中</span>
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

    <section class="card">
      <div class="section-head">
        <h2>我的 AI 设置</h2>
        <span class="label" id="userIdLabel"></span>
      </div>

      <div id="telegramRequired" class="notice hidden">
        请通过 Telegram 机器人里的“控制台”按钮打开此页面，才能读取和保存你的个人设置。
      </div>

      <form id="settingsForm">
        <div class="field">
          <label for="providerSelect">AI Provider</label>
          <select id="providerSelect" disabled>
            <option value="">加载中…</option>
          </select>
        </div>

        <div class="field">
          <label for="modelSelect">模型</label>
          <select id="modelSelect" disabled>
            <option value="">加载中…</option>
          </select>
        </div>

        <div class="field">
          <label for="languageSelect">回复语言</label>
          <select id="languageSelect" disabled></select>
        </div>

        <div class="field">
          <label for="personaSelect">助手人格</label>
          <select id="personaSelect" disabled></select>
        </div>

        <div class="switch-row">
          <div class="switch-copy">
            <strong>自动备用切换</strong>
            <span>当前模型不可用时，尝试其他已配置 Provider。</span>
          </div>
          <label class="switch">
            <input id="fallbackToggle" type="checkbox" disabled />
            <span class="slider"></span>
          </label>
        </div>

        <div id="settingsNotice" class="notice hidden"></div>

        <div class="actions">
          <button class="primary" id="saveButton" type="submit" disabled>保存设置</button>
          <button class="secondary" id="refreshButton" type="button">刷新</button>
        </div>
      </form>
    </section>

    <button class="secondary" id="closeButton" type="button" style="margin-top:14px">关闭控制台</button>

    <p class="small">
      登录身份由 Telegram Mini App 签名验证。网页不会显示或传输任何 AI API Key。
    </p>
  </main>

  <script>
    const tg = window.Telegram && window.Telegram.WebApp
      ? window.Telegram.WebApp
      : null;

    const state = {
      catalog: [],
      settings: null,
      profile: null
    };

    const elements = {
      welcome: document.getElementById('welcome'),
      statusBadge: document.getElementById('statusBadge'),
      provider: document.getElementById('provider'),
      model: document.getElementById('model'),
      uptime: document.getElementById('uptime'),
      messages: document.getElementById('messages'),
      aiCalls: document.getElementById('aiCalls'),
      userIdLabel: document.getElementById('userIdLabel'),
      telegramRequired: document.getElementById('telegramRequired'),
      settingsForm: document.getElementById('settingsForm'),
      providerSelect: document.getElementById('providerSelect'),
      modelSelect: document.getElementById('modelSelect'),
      languageSelect: document.getElementById('languageSelect'),
      personaSelect: document.getElementById('personaSelect'),
      fallbackToggle: document.getElementById('fallbackToggle'),
      settingsNotice: document.getElementById('settingsNotice'),
      saveButton: document.getElementById('saveButton'),
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

    function showNotice(message, type) {
      elements.settingsNotice.textContent = message;
      elements.settingsNotice.className = 'notice ' + (type || '');
    }

    function hideNotice() {
      elements.settingsNotice.className = 'notice hidden';
      elements.settingsNotice.textContent = '';
    }

    function setSettingsEnabled(enabled) {
      elements.providerSelect.disabled = !enabled;
      elements.modelSelect.disabled = !enabled;
      elements.languageSelect.disabled = !enabled;
      elements.personaSelect.disabled = !enabled;
      elements.fallbackToggle.disabled = !enabled;
      elements.saveButton.disabled = !enabled;
    }

    function buildOptions(select, options, selectedValue) {
      select.innerHTML = '';
      options.forEach(function (item) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        option.selected = item.id === selectedValue;
        select.appendChild(option);
      });
    }

    function updateModelOptions(selectedModel) {
      const providerId = elements.providerSelect.value;
      const provider = state.catalog.find(function (item) {
        return item.id === providerId;
      });

      const options = [{ id: '', label: providerId === 'auto' ? '由系统自动选择' : '使用 Provider 默认模型' }];
      const models = provider && Array.isArray(provider.models) ? provider.models : [];

      models.forEach(function (modelId) {
        options.push({ id: modelId, label: modelId });
      });

      if (selectedModel && !options.some(function (item) { return item.id === selectedModel; })) {
        options.push({ id: selectedModel, label: selectedModel + '（当前）' });
      }

      buildOptions(elements.modelSelect, options, selectedModel || '');
      elements.modelSelect.disabled = !state.settings || providerId === 'auto';
    }

    function renderSettings(data) {
      state.catalog = data.providers || [];
      state.settings = data.settings || {};
      state.profile = data.profile || {};

      const providerId = state.settings.providerId || 'auto';
      buildOptions(
        elements.providerSelect,
        state.catalog.map(function (item) {
          return { id: item.id, label: item.label };
        }),
        providerId
      );

      updateModelOptions(state.settings.modelId || '');
      buildOptions(elements.languageSelect, data.languages || [], state.profile.preferredLanguage || 'auto');
      buildOptions(elements.personaSelect, data.personas || [], state.profile.persona || 'default');

      elements.fallbackToggle.checked = state.settings.fallbackEnabled !== false;
      elements.userIdLabel.textContent = state.profile.id ? 'ID ' + state.profile.id : '';
      setSettingsEnabled(true);

      if (elements.providerSelect.value === 'auto') {
        elements.modelSelect.disabled = true;
      }
    }

    function authHeaders(extraHeaders) {
      const headers = Object.assign({}, extraHeaders || {});
      if (tg && tg.initData) {
        headers['X-Telegram-Init-Data'] = tg.initData;
      }
      return headers;
    }

    async function loadStatus() {
      elements.statusBadge.textContent = '检查中';
      elements.statusBadge.className = 'badge';

      try {
        const response = await fetch('/health', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);

        const data = await response.json();
        const stats = data.stats || {};

        elements.statusBadge.textContent = data.ok ? '在线' : '异常';
        elements.statusBadge.className = data.ok ? 'badge' : 'badge error';
        elements.provider.textContent = data.provider || '未配置';
        elements.model.textContent = data.model || '未配置';
        elements.uptime.textContent = formatUptime(data.uptime);
        elements.messages.textContent = String(stats.messagesHandled ?? 0);
        elements.aiCalls.textContent = String(stats.aiCalls ?? 0);
      } catch (error) {
        elements.statusBadge.textContent = '连接失败';
        elements.statusBadge.className = 'badge error';
      }
    }

    async function loadSettings() {
      hideNotice();

      if (!tg || !tg.initData) {
        elements.telegramRequired.className = 'notice';
        setSettingsEnabled(false);
        return;
      }

      setSettingsEnabled(false);
      showNotice('正在读取个人设置…', '');

      try {
        const response = await fetch('/api/miniapp/settings', {
          method: 'GET',
          cache: 'no-store',
          headers: authHeaders()
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || '读取失败');
        }

        renderSettings(data);
        hideNotice();
      } catch (error) {
        setSettingsEnabled(false);
        showNotice(error.message || '读取个人设置失败。', 'failure');
      }
    }

    async function saveSettings(event) {
      event.preventDefault();

      if (!tg || !tg.initData) {
        showNotice('请从 Telegram 机器人内打开控制台。', 'failure');
        return;
      }

      elements.saveButton.disabled = true;
      elements.saveButton.textContent = '保存中…';
      hideNotice();

      try {
        const response = await fetch('/api/miniapp/settings', {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            providerId: elements.providerSelect.value,
            modelId: elements.modelSelect.value,
            fallbackEnabled: elements.fallbackToggle.checked,
            preferredLanguage: elements.languageSelect.value,
            persona: elements.personaSelect.value
          })
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || '保存失败');
        }

        renderSettings(data);
        showNotice('设置已保存，下一条消息开始生效。', 'success');

        if (tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('success');
        }
      } catch (error) {
        showNotice(error.message || '保存失败，请稍后重试。', 'failure');
        if (tg && tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('error');
        }
      } finally {
        elements.saveButton.disabled = false;
        elements.saveButton.textContent = '保存设置';
      }
    }

    function setupTelegram() {
      if (!tg) {
        elements.welcome.textContent = '当前在普通浏览器中打开，可查看状态；个人设置需要从 Telegram 打开。';
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
        ? '你好，' + name + '。这里可以管理你的个人 AI 设置。'
        : '已在 Telegram 中打开 Bot 控制台。';
    }

    elements.providerSelect.addEventListener('change', function () {
      updateModelOptions('');
    });

    elements.settingsForm.addEventListener('submit', saveSettings);

    elements.refreshButton.addEventListener('click', function () {
      loadStatus();
      loadSettings();
    });

    elements.closeButton.addEventListener('click', function () {
      if (tg) {
        tg.close();
      } else {
        window.history.back();
      }
    });

    setupTelegram();
    loadStatus();
    loadSettings();
  </script>
</body>
</html>`;

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

function sendJson(res, statusCode, payload) {
  applySecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  applySecurityHeaders(res);
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

function hasProviderCredential(config, providerId) {
  const credentialMap = {
    gemini: config.geminiApiKey,
    'gemini-live': config.geminiLiveApiKey || config.geminiApiKey,
    groq: config.groqApiKey,
    openrouter: config.openrouterApiKey,
    'github-models': config.githubModelsApiKey,
    huggingface: config.huggingfaceApiKey,
    mistral: config.mistralApiKey,
    openai: config.openaiApiKey,
    'openai-compatible': config.aiApiKey,
    anthropic: config.anthropicApiKey,
    deepseek: config.deepseekApiKey,
    qwen: config.qwenApiKey,
    grok: config.grokApiKey,
    glm: config.glmApiKey,
    doubao: config.doubaoApiKey
  };

  return Boolean(credentialMap[providerId]);
}

function buildProviderCatalog(config) {
  const currentProvider = String(config.aiProvider || '');
  const fallbackProviders = Array.isArray(config.aiProviderFallbackOrder)
    ? config.aiProviderFallbackOrder
    : [];

  return PROVIDER_ORDER
    .filter((providerId) => {
      if (providerId === 'auto') return true;
      return (
        hasProviderCredential(config, providerId) ||
        providerId === currentProvider ||
        fallbackProviders.includes(providerId)
      );
    })
    .map((providerId) => ({
      id: providerId,
      label: PROVIDER_LABELS[providerId] || providerId,
      models:
        providerId === 'auto'
          ? []
          : Array.from(
              new Set(
                [
                  ...(config.providerModels?.[providerId] || []),
                  providerId === currentProvider ? config.defaultModel : ''
                ]
                  .map((item) => String(item || '').trim())
                  .filter(Boolean)
              )
            )
    }));
}

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    throw new Error('TELEGRAM_AUTH_REQUIRED');
  }

  const params = new URLSearchParams(String(initData));
  const receivedHash = params.get('hash') || '';
  params.delete('hash');

  if (!/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new Error('TELEGRAM_AUTH_INVALID');
  }

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const receivedBuffer = Buffer.from(receivedHash, 'hex');

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new Error('TELEGRAM_AUTH_INVALID');
  }

  const authDate = Number.parseInt(params.get('auth_date') || '0', 10);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    !Number.isFinite(authDate) ||
    authDate <= 0 ||
    authDate > nowSeconds + 60 ||
    nowSeconds - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS
  ) {
    throw new Error('TELEGRAM_AUTH_EXPIRED');
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || '{}');
  } catch {
    throw new Error('TELEGRAM_USER_INVALID');
  }

  if (!user || !user.id) {
    throw new Error('TELEGRAM_USER_INVALID');
  }

  return user;
}

function getTelegramInitData(req) {
  const header = req.headers['x-telegram-init-data'];
  return Array.isArray(header) ? header[0] || '' : String(header || '');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);

      if (size > MAX_JSON_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }

      body += chunk;
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', reject);
  });
}

function isAdminUser(config, userId) {
  const adminIds = Array.isArray(config.adminUserIds) ? config.adminUserIds : [];
  return adminIds.map(String).includes(String(userId));
}

async function getAuthenticatedUser(req, { db, config }) {
  const initData = getTelegramInitData(req);
  const telegramUser = verifyTelegramInitData(initData, config.botToken);

  const user = await db.upsertUser(telegramUser, {
    isAdmin: isAdminUser(config, telegramUser.id)
  });

  return { telegramUser, user };
}

function serializeSettingsResponse({ db, config, userId }) {
  const user = db.findUser(userId);
  const settings = db.getUserAISettings(userId);

  return {
    ok: true,
    profile: {
      id: String(user?.id || userId),
      username: user?.username || '',
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      preferredLanguage: user?.preferredLanguage || 'auto',
      persona: user?.persona || 'default',
      isAdmin: Boolean(user?.isAdmin)
    },
    settings: {
      providerId: settings.providerId || 'auto',
      modelId: settings.modelId || '',
      fallbackEnabled: settings.fallbackEnabled !== false,
      updatedAt: settings.updatedAt || ''
    },
    providers: buildProviderCatalog(config),
    languages: LANGUAGE_OPTIONS,
    personas: PERSONA_OPTIONS
  };
}

function validateSettingsPayload(payload, config) {
  const catalog = buildProviderCatalog(config);
  const providerIds = new Set(catalog.map((item) => item.id));
  const providerId = String(payload.providerId || 'auto').trim();

  if (!providerIds.has(providerId)) {
    throw new Error('PROVIDER_NOT_AVAILABLE');
  }

  const provider = catalog.find((item) => item.id === providerId);
  const allowedModels = new Set(provider?.models || []);
  const modelId = String(payload.modelId || '').trim();

  if (providerId === 'auto' && modelId) {
    throw new Error('AUTO_PROVIDER_MODEL_MUST_BE_EMPTY');
  }

  if (modelId && !allowedModels.has(modelId)) {
    throw new Error('MODEL_NOT_AVAILABLE');
  }

  const preferredLanguage = String(payload.preferredLanguage || 'auto').trim();
  if (!LANGUAGE_OPTIONS.some((item) => item.id === preferredLanguage)) {
    throw new Error('LANGUAGE_NOT_AVAILABLE');
  }

  const persona = String(payload.persona || 'default').trim();
  if (!PERSONA_OPTIONS.some((item) => item.id === persona)) {
    throw new Error('PERSONA_NOT_AVAILABLE');
  }

  return {
    providerId,
    modelId,
    fallbackEnabled: payload.fallbackEnabled !== false,
    preferredLanguage,
    persona
  };
}

function authErrorResponse(error) {
  const code = String(error?.message || 'TELEGRAM_AUTH_INVALID');

  if (code === 'TELEGRAM_AUTH_EXPIRED') {
    return {
      statusCode: 401,
      payload: {
        ok: false,
        error: code,
        message: '登录信息已过期，请关闭控制台后从机器人重新打开。'
      }
    };
  }

  return {
    statusCode: 401,
    payload: {
      ok: false,
      error: code,
      message: 'Telegram 身份验证失败，请从机器人内重新打开控制台。'
    }
  };
}

async function handleMiniAppApi(req, res, context) {
  let auth;

  try {
    auth = await getAuthenticatedUser(req, context);
  } catch (error) {
    const response = authErrorResponse(error);
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  if (req.method === 'GET') {
    sendJson(
      res,
      200,
      serializeSettingsResponse({
        db: context.db,
        config: context.config,
        userId: auth.telegramUser.id
      })
    );
    return;
  }

  if (req.method === 'PUT') {
    try {
      const payload = await readJsonBody(req);
      const next = validateSettingsPayload(payload, context.config);

      context.db.setUserAISettings(auth.telegramUser.id, {
        providerId: next.providerId === 'auto' ? '' : next.providerId,
        modelId: next.modelId,
        fallbackEnabled: next.fallbackEnabled
      });

      await context.db.setUserSettings(auth.telegramUser.id, {
        preferredLanguage: next.preferredLanguage,
        persona: next.persona
      });

      sendJson(
        res,
        200,
        serializeSettingsResponse({
          db: context.db,
          config: context.config,
          userId: auth.telegramUser.id
        })
      );
    } catch (error) {
      const code = String(error?.message || 'SETTINGS_SAVE_FAILED');
      const statusCode = ['INVALID_JSON', 'BODY_TOO_LARGE'].includes(code) ? 400 : 422;

      sendJson(res, statusCode, {
        ok: false,
        error: code,
        message: '设置内容无效或当前 Provider/模型不可用。'
      });
    }
    return;
  }

  res.setHeader('Allow', 'GET, PUT');
  sendJson(res, 405, {
    ok: false,
    error: 'METHOD_NOT_ALLOWED'
  });
}

export function startHealthServer({ port, db, config, logger }) {
  const context = { db, config, logger };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/app' || pathname === '/app/') {
        sendHtml(res, 200, MINI_APP_HTML);
        return;
      }

      if (pathname === '/api/miniapp/settings') {
        await handleMiniAppApi(req, res, context);
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
        availableRoutes: ['/', '/app', '/api/miniapp/settings', '/health', '/ready']
      });
    })().catch((error) => {
      logger.error('Health/Mini App server request failed', {
        method: req.method,
        url: req.url,
        error: error.message
      });

      if (!res.headersSent) {
        sendJson(res, 500, {
          ok: false,
          error: 'INTERNAL_SERVER_ERROR'
        });
      } else {
        res.end();
      }
    });
  });

  server.listen(port, () => {
    logger.info(`Health server listening on :${port}`, {
      routes: ['/', '/app', '/api/miniapp/settings', '/health', '/ready']
    });
  });

  return server;
}
