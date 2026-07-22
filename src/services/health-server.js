import crypto from 'node:crypto';
import http from 'node:http';
import { BILLING_CREDIT_TYPES } from '../db.js';

const TELEGRAM_AUTH_MAX_AGE_SECONDS = 60 * 60;
const MAX_JSON_BODY_BYTES = 32 * 1024;
const MAX_ADMIN_CREDIT_BALANCE = 1_000_000_000;

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

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .stat-box {
      min-width: 0;
      padding: 14px;
      border-radius: 14px;
      background: var(--tg-theme-bg-color, #f9fafb);
    }

    .stat-box span {
      display: block;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
    }

    .stat-box strong {
      display: block;
      margin-top: 6px;
      font-size: 21px;
      word-break: break-word;
    }

    .subsection {
      margin-top: 20px;
      padding-top: 17px;
      border-top: 1px solid rgba(127, 127, 127, .18);
    }

    .subsection-title {
      margin: 0 0 10px;
      font-size: 15px;
    }

    .provider-list,
    .user-list {
      display: grid;
      gap: 10px;
    }

    .provider-item,
    .user-item {
      padding: 13px;
      border-radius: 14px;
      background: var(--tg-theme-bg-color, #f9fafb);
    }

    .provider-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .provider-name,
    .user-name {
      font-weight: 800;
      word-break: break-word;
    }

    .provider-meta,
    .user-meta {
      margin-top: 4px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
      line-height: 1.45;
      word-break: break-word;
    }

    .status-pill {
      flex: 0 0 auto;
      padding: 5px 8px;
      border-radius: 999px;
      color: #166534;
      background: rgba(22, 163, 74, .12);
      font-size: 11px;
      font-weight: 800;
    }

    .status-pill.muted {
      color: var(--tg-theme-hint-color, #6b7280);
      background: rgba(127, 127, 127, .12);
    }

    .status-pill.blocked {
      color: #991b1b;
      background: rgba(220, 38, 38, .12);
    }

    .admin-toolbar {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      margin-bottom: 10px;
    }

    input[type="search"],
    input[type="number"] {
      min-width: 0;
      min-height: 44px;
      padding: 0 12px;
      border: 1px solid rgba(127, 127, 127, .25);
      border-radius: 12px;
      color: var(--tg-theme-text-color, #111827);
      background: var(--tg-theme-bg-color, #f9fafb);
      font: inherit;
      outline: none;
    }

    input[type="search"]:focus,
    input[type="number"]:focus {
      border-color: var(--tg-theme-button-color, #2481cc);
    }

    .compact-button {
      width: auto;
      min-height: 40px;
      padding: 9px 13px;
      font-size: 13px;
    }

    .danger-button {
      color: #ffffff;
      background: #dc2626;
    }

    .success-button {
      color: #ffffff;
      background: #16a34a;
    }

    .user-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .user-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 11px;
    }

    .quota-editor {
      display: grid;
      grid-template-columns: minmax(120px, 1fr) auto auto;
      gap: 8px;
      align-items: end;
      margin-top: 11px;
      padding-top: 11px;
      border-top: 1px solid rgba(127, 127, 127, .16);
    }

    .quota-field {
      display: grid;
      gap: 5px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
    }

    .quota-field input {
      width: 100%;
      min-height: 40px;
    }

    .credit-editor {
      margin-top: 11px;
      padding-top: 11px;
      border-top: 1px solid rgba(127, 127, 127, .16);
    }

    .credit-editor-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }

    .credit-editor-title {
      font-size: 13px;
      font-weight: 800;
    }

    .credit-editor-note {
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 11px;
    }

    .credit-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .credit-field {
      display: grid;
      gap: 5px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
    }

    .credit-field input {
      width: 100%;
      min-height: 40px;
    }

    .credit-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 8px;
    }

    @media (max-width: 520px) {
      .quota-editor {
        grid-template-columns: 1fr 1fr;
      }

      .quota-field {
        grid-column: 1 / -1;
      }

      .credit-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .history-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 12px 0;
    }

    .session-list {
      display: grid;
      gap: 10px;
    }

    .session-item {
      padding: 13px;
      border-radius: 14px;
      background: var(--tg-theme-bg-color, #f9fafb);
    }

    .session-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .session-title {
      font-weight: 800;
      word-break: break-word;
    }

    .session-meta {
      margin-top: 4px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
      line-height: 1.45;
      word-break: break-word;
    }

    .session-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 11px;
    }

    .conversation-viewer {
      margin-top: 14px;
      padding: 14px;
      border-radius: 14px;
      background: var(--tg-theme-bg-color, #f9fafb);
    }

    .conversation-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .conversation-messages {
      display: grid;
      gap: 10px;
      max-height: 520px;
      overflow-y: auto;
      padding-right: 2px;
    }

    .message-item {
      padding: 11px 12px;
      border-radius: 13px;
      background: var(--tg-theme-secondary-bg-color, #ffffff);
      border: 1px solid rgba(127, 127, 127, .15);
    }

    .message-item.assistant {
      border-left: 3px solid var(--tg-theme-button-color, #2481cc);
    }

    .message-item.user {
      border-left: 3px solid #16a34a;
    }

    .message-role {
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .message-content {
      margin-top: 6px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 14px;
      line-height: 1.55;
    }

    .message-meta {
      margin-top: 7px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 11px;
      word-break: break-word;
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

    <section class="card" id="historyPanel">
      <div class="section-head">
        <h2>聊天记录</h2>
        <span class="badge" id="historyCount">—</span>
      </div>

      <div id="historyNotice" class="notice hidden"></div>

      <div class="history-toolbar">
        <button class="secondary compact-button" id="historyRefreshButton" type="button">刷新记录</button>
        <button class="danger-button compact-button" id="historyClearAllButton" type="button" disabled>清空全部</button>
      </div>

      <div class="session-list" id="historySessionList"></div>

      <div class="conversation-viewer hidden" id="historyViewer">
        <div class="conversation-head">
          <strong id="historyViewerTitle">会话内容</strong>
          <button class="secondary compact-button" id="historyViewerClose" type="button">关闭</button>
        </div>
        <div class="conversation-messages" id="historyMessages"></div>
      </div>
    </section>

    <section class="card hidden" id="adminPanel">
      <div class="section-head">
        <h2>管理员面板</h2>
        <span class="badge">管理员</span>
      </div>

      <div id="adminNotice" class="notice hidden"></div>

      <div class="stats-grid">
        <div class="stat-box">
          <span>用户总数</span>
          <strong id="adminTotalUsers">—</strong>
        </div>
        <div class="stat-box">
          <span>全局默认额度</span>
          <strong id="adminDailyQuota">—</strong>
        </div>
        <div class="stat-box">
          <span>已处理消息</span>
          <strong id="adminMessages">—</strong>
        </div>
        <div class="stat-box">
          <span>AI 调用</span>
          <strong id="adminAiCalls">—</strong>
        </div>
      </div>

      <div class="subsection">
        <h3 class="subsection-title">Provider 配置状态</h3>
        <div class="provider-list" id="adminProviderList"></div>
      </div>

      <div class="subsection">
        <h3 class="subsection-title">用户管理</h3>
        <p class="small">全局额度是账号的默认值；可以在下方为每个账号单独覆盖，0 表示不限。</p>
        <p class="small">六类已购额度余额可按账号独立修改，与每日免费额度分开计算；管理员使用仍然免费。</p>
        <div class="admin-toolbar">
          <input id="adminUserSearch" type="search" placeholder="搜索 ID、用户名或姓名" />
          <button class="secondary compact-button" id="adminSearchButton" type="button">搜索</button>
        </div>
        <div class="user-list" id="adminUserList"></div>
      </div>

      <div class="subsection">
        <h3 class="subsection-title">会话概况</h3>
        <div class="admin-toolbar">
          <input id="adminSessionUserSearch" type="search" placeholder="按 Telegram 用户 ID 筛选" />
          <button class="secondary compact-button" id="adminSessionSearchButton" type="button">筛选</button>
        </div>
        <div class="session-list" id="adminSessionList"></div>
        <div class="conversation-viewer hidden" id="adminSessionViewer">
          <div class="conversation-head">
            <strong id="adminSessionViewerTitle">会话摘要</strong>
            <button class="secondary compact-button" id="adminSessionViewerClose" type="button">关闭</button>
          </div>
          <div class="conversation-messages" id="adminSessionMessages"></div>
        </div>
      </div>
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
    const creditDefinitions = [
      { id: 'chat', label: '聊天' },
      { id: 'vision', label: '识图' },
      { id: 'image_generation', label: '画图' },
      { id: 'tts', label: 'TTS' },
      { id: 'live_voice', label: '实时语音' },
      { id: 'video', label: '视频' }
    ];
    const maxAdminCreditBalance = 1000000000;

    const state = {
      catalog: [],
      settings: null,
      profile: null,
      historyLoaded: false,
      sessions: [],
      adminLoaded: false,
      adminUsers: [],
      adminSessions: []
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
      historyPanel: document.getElementById('historyPanel'),
      historyCount: document.getElementById('historyCount'),
      historyNotice: document.getElementById('historyNotice'),
      historyRefreshButton: document.getElementById('historyRefreshButton'),
      historyClearAllButton: document.getElementById('historyClearAllButton'),
      historySessionList: document.getElementById('historySessionList'),
      historyViewer: document.getElementById('historyViewer'),
      historyViewerTitle: document.getElementById('historyViewerTitle'),
      historyViewerClose: document.getElementById('historyViewerClose'),
      historyMessages: document.getElementById('historyMessages'),
      adminPanel: document.getElementById('adminPanel'),
      adminNotice: document.getElementById('adminNotice'),
      adminTotalUsers: document.getElementById('adminTotalUsers'),
      adminDailyQuota: document.getElementById('adminDailyQuota'),
      adminMessages: document.getElementById('adminMessages'),
      adminAiCalls: document.getElementById('adminAiCalls'),
      adminProviderList: document.getElementById('adminProviderList'),
      adminUserSearch: document.getElementById('adminUserSearch'),
      adminSearchButton: document.getElementById('adminSearchButton'),
      adminUserList: document.getElementById('adminUserList'),
      adminSessionUserSearch: document.getElementById('adminSessionUserSearch'),
      adminSessionSearchButton: document.getElementById('adminSessionSearchButton'),
      adminSessionList: document.getElementById('adminSessionList'),
      adminSessionViewer: document.getElementById('adminSessionViewer'),
      adminSessionViewerTitle: document.getElementById('adminSessionViewerTitle'),
      adminSessionViewerClose: document.getElementById('adminSessionViewerClose'),
      adminSessionMessages: document.getElementById('adminSessionMessages'),
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

      if (!state.historyLoaded) {
        loadMySessions();
      }

      if (state.profile.isAdmin) {
        elements.adminPanel.classList.remove('hidden');
        if (!state.adminLoaded) {
          loadAdmin();
        }
      } else {
        elements.adminPanel.classList.add('hidden');
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

    function showHistoryNotice(message, type) {
      elements.historyNotice.textContent = message;
      elements.historyNotice.className = 'notice ' + (type || '');
    }

    function hideHistoryNotice() {
      elements.historyNotice.className = 'notice hidden';
      elements.historyNotice.textContent = '';
    }

    function formatDateTime(value) {
      if (!value) return '未知时间';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    }

    function sessionDisplayName(session) {
      if (session.name && session.name !== 'main') return session.name;
      if (session.isDefault) return '默认会话';
      return '会话 ' + String(session.id || '').slice(-8);
    }

    function renderConversationMessages(container, messages) {
      container.innerHTML = '';

      (messages || []).forEach(function (message) {
        const item = document.createElement('div');
        const role = String(message.role || 'message').toLowerCase();
        item.className = 'message-item ' + (role === 'assistant' ? 'assistant' : role === 'user' ? 'user' : '');

        const roleLabel = document.createElement('div');
        const content = document.createElement('div');
        const meta = document.createElement('div');

        roleLabel.className = 'message-role';
        roleLabel.textContent = role === 'assistant' ? 'AI 助手' : role === 'user' ? '用户' : role;

        content.className = 'message-content';
        content.textContent = String(message.content || '');

        meta.className = 'message-meta';
        meta.textContent = [message.model || '', formatDateTime(message.createdAt)].filter(Boolean).join(' · ');

        item.appendChild(roleLabel);
        item.appendChild(content);
        item.appendChild(meta);
        container.appendChild(item);
      });

      if (!container.children.length) {
        const empty = document.createElement('div');
        empty.className = 'notice';
        empty.textContent = '这个会话还没有可显示的消息。';
        container.appendChild(empty);
      }
    }

    function renderMySessions(sessions) {
      state.sessions = sessions || [];
      elements.historySessionList.innerHTML = '';
      elements.historyCount.textContent = String(state.sessions.length);
      elements.historyClearAllButton.disabled = state.sessions.length === 0;

      state.sessions.forEach(function (session) {
        const item = document.createElement('div');
        item.className = 'session-item';

        const head = document.createElement('div');
        head.className = 'session-head';

        const copy = document.createElement('div');
        const title = document.createElement('div');
        const meta = document.createElement('div');
        const pill = document.createElement('span');

        title.className = 'session-title';
        title.textContent = sessionDisplayName(session);

        meta.className = 'session-meta';
        meta.textContent = [
          '聊天 ' + session.chatId,
          session.threadId && session.threadId !== 'main' ? '话题 ' + session.threadId : '',
          '最近 ' + formatDateTime(session.lastAccessedAt)
        ].filter(Boolean).join(' · ');

        pill.className = session.status === 'active' ? 'status-pill' : 'status-pill muted';
        pill.textContent = session.status === 'active' ? '活跃' : session.status;

        copy.appendChild(title);
        copy.appendChild(meta);
        head.appendChild(copy);
        head.appendChild(pill);
        item.appendChild(head);

        const actions = document.createElement('div');
        actions.className = 'session-actions';

        const viewButton = document.createElement('button');
        viewButton.type = 'button';
        viewButton.className = 'secondary compact-button';
        viewButton.textContent = '查看记录';
        viewButton.dataset.sessionAction = 'view';
        viewButton.dataset.sessionId = session.id;

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'danger-button compact-button';
        deleteButton.textContent = '清空会话';
        deleteButton.dataset.sessionAction = 'delete';
        deleteButton.dataset.sessionId = session.id;

        actions.appendChild(viewButton);
        actions.appendChild(deleteButton);
        item.appendChild(actions);
        elements.historySessionList.appendChild(item);
      });

      if (!elements.historySessionList.children.length) {
        const empty = document.createElement('div');
        empty.className = 'notice';
        empty.textContent = '暂时没有聊天记录。给机器人发送消息后会在这里出现。';
        elements.historySessionList.appendChild(empty);
      }
    }

    async function loadMySessions() {
      if (!tg || !tg.initData) {
        renderMySessions([]);
        showHistoryNotice('请通过 Telegram 机器人里的“控制台”按钮打开，才能查看聊天记录。', '');
        return;
      }
      showHistoryNotice('正在读取聊天记录…', '');

      try {
        const response = await fetch('/api/miniapp/sessions?limit=50', {
          method: 'GET',
          cache: 'no-store',
          headers: authHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '读取聊天记录失败');

        renderMySessions(data.items || []);
        state.historyLoaded = true;
        hideHistoryNotice();
      } catch (error) {
        showHistoryNotice(error.message || '读取聊天记录失败。', 'failure');
      }
    }

    async function viewMySession(sessionId) {
      showHistoryNotice('正在读取会话内容…', '');

      try {
        const response = await fetch('/api/miniapp/sessions/' + encodeURIComponent(sessionId) + '?limit=100', {
          method: 'GET',
          cache: 'no-store',
          headers: authHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '读取会话失败');

        elements.historyViewerTitle.textContent = sessionDisplayName(data.session || {});
        renderConversationMessages(elements.historyMessages, data.messages || []);
        elements.historyViewer.classList.remove('hidden');
        hideHistoryNotice();
        elements.historyViewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        showHistoryNotice(error.message || '读取会话失败。', 'failure');
      }
    }

    async function deleteMySession(sessionId) {
      const accepted = await askConfirmation('确定清空这个会话吗？清空后无法恢复。');
      if (!accepted) return;

      showHistoryNotice('正在清空会话…', '');

      try {
        const response = await fetch('/api/miniapp/sessions/' + encodeURIComponent(sessionId), {
          method: 'DELETE',
          headers: authHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '清空失败');

        elements.historyViewer.classList.add('hidden');
        await loadMySessions();
        showHistoryNotice('会话已清空。下一条消息会自动创建新会话。', 'success');
      } catch (error) {
        showHistoryNotice(error.message || '清空会话失败。', 'failure');
      }
    }

    async function clearAllMySessions() {
      const accepted = await askConfirmation('确定清空全部聊天记录吗？此操作无法恢复。');
      if (!accepted) return;

      elements.historyClearAllButton.disabled = true;
      showHistoryNotice('正在清空全部聊天记录…', '');

      try {
        const response = await fetch('/api/miniapp/sessions', {
          method: 'DELETE',
          headers: authHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '清空失败');

        elements.historyViewer.classList.add('hidden');
        renderMySessions([]);
        showHistoryNotice('已清空 ' + Number(data.deleted || 0) + ' 个会话。', 'success');
      } catch (error) {
        showHistoryNotice(error.message || '清空全部聊天记录失败。', 'failure');
        elements.historyClearAllButton.disabled = state.sessions.length === 0;
      }
    }

    function showAdminNotice(message, type) {
      elements.adminNotice.textContent = message;
      elements.adminNotice.className = 'notice ' + (type || '');
    }

    function hideAdminNotice() {
      elements.adminNotice.className = 'notice hidden';
      elements.adminNotice.textContent = '';
    }

    function renderProviderStatus(providers) {
      elements.adminProviderList.innerHTML = '';

      (providers || []).forEach(function (provider) {
        const item = document.createElement('div');
        item.className = 'provider-item';

        const copy = document.createElement('div');
        const name = document.createElement('div');
        const meta = document.createElement('div');
        const pill = document.createElement('span');

        name.className = 'provider-name';
        name.textContent = provider.label || provider.id;

        meta.className = 'provider-meta';
        meta.textContent =
          (provider.modelCount || 0) + ' 个模型' +
          (provider.current ? ' · 当前默认' : '');

        pill.className = provider.configured ? 'status-pill' : 'status-pill muted';
        pill.textContent = provider.configured ? '已配置' : '未配置';

        copy.appendChild(name);
        copy.appendChild(meta);
        item.appendChild(copy);
        item.appendChild(pill);
        elements.adminProviderList.appendChild(item);
      });

      if (!elements.adminProviderList.children.length) {
        elements.adminProviderList.textContent = '暂无 Provider 信息。';
      }
    }

    function userDisplayName(user) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
      if (fullName) return fullName;
      if (user.username) return '@' + user.username;
      return '用户 ' + user.id;
    }

    function quotaDisplayValue(value) {
      return Number(value || 0) > 0 ? String(Number(value)) : '不限';
    }

    function renderAdminUsers(users) {
      state.adminUsers = users || [];
      elements.adminUserList.innerHTML = '';

      state.adminUsers.forEach(function (user) {
        const item = document.createElement('div');
        item.className = 'user-item';

        const head = document.createElement('div');
        head.className = 'user-head';

        const copy = document.createElement('div');
        const name = document.createElement('div');
        const meta = document.createElement('div');
        const pill = document.createElement('span');

        name.className = 'user-name';
        name.textContent = userDisplayName(user);

        meta.className = 'user-meta';
        const parts = [
          'ID ' + user.id,
          user.username ? '@' + user.username : '',
          '今日使用 ' + Number(user.dailyUsageCount || 0) + ' / ' + quotaDisplayValue(user.dailyQuota),
          user.usesGlobalQuota
            ? '使用全局默认额度'
            : '个人额度 ' + quotaDisplayValue(user.dailyQuotaOverride),
          '累计请求 ' + Number(user.totalMessages || 0)
        ].filter(Boolean);
        meta.textContent = parts.join(' · ');

        if (user.isAdmin) {
          pill.className = 'status-pill';
          pill.textContent = '管理员';
        } else if (user.isBlocked) {
          pill.className = 'status-pill blocked';
          pill.textContent = '已封禁';
        } else {
          pill.className = 'status-pill muted';
          pill.textContent = '正常';
        }

        copy.appendChild(name);
        copy.appendChild(meta);
        head.appendChild(copy);
        head.appendChild(pill);
        item.appendChild(head);

        const actions = document.createElement('div');
        actions.className = 'user-actions';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = user.isBlocked
          ? 'success-button compact-button'
          : 'danger-button compact-button';
        button.textContent = user.isBlocked ? '解除封禁' : '封禁用户';
        button.dataset.userId = String(user.id);
        button.dataset.blocked = user.isBlocked ? 'true' : 'false';
        button.dataset.userAction = 'toggle-block';

        const isSelf = state.profile && String(state.profile.id) === String(user.id);
        button.disabled = Boolean(user.isAdmin || isSelf);
        if (isSelf) button.textContent = '当前账号';
        if (user.isAdmin && !isSelf) button.textContent = '管理员账号';

        actions.appendChild(button);
        item.appendChild(actions);

        const quotaEditor = document.createElement('div');
        quotaEditor.className = 'quota-editor';

        const quotaField = document.createElement('label');
        quotaField.className = 'quota-field';
        quotaField.textContent = '个人每日额度（0 表示不限）';

        const quotaInput = document.createElement('input');
        quotaInput.type = 'number';
        quotaInput.min = '0';
        quotaInput.max = '1000000';
        quotaInput.step = '1';
        quotaInput.inputMode = 'numeric';
        quotaInput.dataset.userQuotaInput = String(user.id);
        quotaInput.value = user.usesGlobalQuota ? '' : String(Number(user.dailyQuotaOverride || 0));
        quotaInput.placeholder = '全局默认：' + quotaDisplayValue(user.dailyQuota);
        quotaField.appendChild(quotaInput);

        const saveQuota = document.createElement('button');
        saveQuota.type = 'button';
        saveQuota.className = 'primary compact-button';
        saveQuota.textContent = '保存个人额度';
        saveQuota.dataset.userId = String(user.id);
        saveQuota.dataset.userAction = 'save-quota';

        const resetQuota = document.createElement('button');
        resetQuota.type = 'button';
        resetQuota.className = 'secondary compact-button';
        resetQuota.textContent = '恢复全局默认';
        resetQuota.dataset.userId = String(user.id);
        resetQuota.dataset.userAction = 'reset-quota';
        resetQuota.disabled = Boolean(user.usesGlobalQuota);

        quotaEditor.appendChild(quotaField);
        quotaEditor.appendChild(saveQuota);
        quotaEditor.appendChild(resetQuota);
        item.appendChild(quotaEditor);

        const creditEditor = document.createElement('div');
        creditEditor.className = 'credit-editor';

        const creditHead = document.createElement('div');
        creditHead.className = 'credit-editor-head';
        const creditTitle = document.createElement('span');
        creditTitle.className = 'credit-editor-title';
        creditTitle.textContent = '已购额度余额';
        const creditNote = document.createElement('span');
        creditNote.className = 'credit-editor-note';
        creditNote.textContent = '不影响每日免费额度';
        creditHead.appendChild(creditTitle);
        creditHead.appendChild(creditNote);
        creditEditor.appendChild(creditHead);

        const creditGrid = document.createElement('div');
        creditGrid.className = 'credit-grid';
        const balances = user.creditBalances || {};
        creditDefinitions.forEach(function (credit) {
          const field = document.createElement('label');
          field.className = 'credit-field';
          field.textContent = credit.label;

          const input = document.createElement('input');
          input.type = 'number';
          input.min = '0';
          input.max = String(maxAdminCreditBalance);
          input.step = '1';
          input.inputMode = 'numeric';
          input.value = String(Number(balances[credit.id] || 0));
          input.dataset.userCreditInput = String(user.id);
          input.dataset.creditType = credit.id;
          field.appendChild(input);
          creditGrid.appendChild(field);
        });
        creditEditor.appendChild(creditGrid);

        const creditActions = document.createElement('div');
        creditActions.className = 'credit-actions';
        const saveCredits = document.createElement('button');
        saveCredits.type = 'button';
        saveCredits.className = 'primary compact-button';
        saveCredits.textContent = '保存已购额度';
        saveCredits.dataset.userId = String(user.id);
        saveCredits.dataset.userAction = 'save-credits';
        creditActions.appendChild(saveCredits);
        creditEditor.appendChild(creditActions);
        item.appendChild(creditEditor);
        elements.adminUserList.appendChild(item);
      });

      if (!elements.adminUserList.children.length) {
        const empty = document.createElement('div');
        empty.className = 'notice';
        empty.textContent = '没有找到用户。';
        elements.adminUserList.appendChild(empty);
      }
    }

    async function fetchAdminUsers(query) {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (query) params.set('q', query);

      const response = await fetch('/api/miniapp/admin/users?' + params.toString(), {
        method: 'GET',
        cache: 'no-store',
        headers: authHeaders()
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || '读取用户失败');
      }

      renderAdminUsers(data.items || []);
    }

    async function loadAdmin() {
      if (!state.profile || !state.profile.isAdmin) return;

      showAdminNotice('正在读取管理员数据…', '');

      try {
        const response = await fetch('/api/miniapp/admin/overview', {
          method: 'GET',
          cache: 'no-store',
          headers: authHeaders()
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || '读取管理员数据失败');
        }

        const stats = data.stats || {};
        elements.adminTotalUsers.textContent = String(data.totalUsers ?? 0);
        elements.adminDailyQuota.textContent = quotaDisplayValue(data.dailyQuota);
        elements.adminMessages.textContent = String(stats.messagesHandled ?? 0);
        elements.adminAiCalls.textContent = String(stats.aiCalls ?? 0);
        renderProviderStatus(data.providers || []);
        await fetchAdminUsers(elements.adminUserSearch.value.trim());
        await fetchAdminSessions(elements.adminSessionUserSearch.value.trim());

        state.adminLoaded = true;
        hideAdminNotice();
      } catch (error) {
        showAdminNotice(error.message || '读取管理员数据失败。', 'failure');
      }
    }

    function askConfirmation(message) {
      return new Promise(function (resolve) {
        if (tg && typeof tg.showConfirm === 'function') {
          tg.showConfirm(message, resolve);
          return;
        }

        resolve(window.confirm(message));
      });
    }

    async function updateUserBlock(userId, currentlyBlocked) {
      const nextBlocked = !currentlyBlocked;
      const accepted = await askConfirmation(
        nextBlocked ? '确定封禁这个用户吗？' : '确定解除这个用户的封禁吗？'
      );

      if (!accepted) return;

      showAdminNotice(nextBlocked ? '正在封禁用户…' : '正在解除封禁…', '');

      try {
        const response = await fetch(
          '/api/miniapp/admin/users/' + encodeURIComponent(userId),
          {
            method: 'PATCH',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ isBlocked: nextBlocked })
          }
        );

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || '操作失败');
        }

        await fetchAdminUsers(elements.adminUserSearch.value.trim());
        showAdminNotice(nextBlocked ? '用户已封禁。' : '用户已解除封禁。', 'success');

        if (tg && tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('success');
        }
      } catch (error) {
        showAdminNotice(error.message || '操作失败。', 'failure');
        if (tg && tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('error');
        }
      }
    }

    async function updateUserQuota(userId, resetToGlobal) {
      let dailyQuota = null;

      if (!resetToGlobal) {
        const input = Array.from(
          elements.adminUserList.querySelectorAll('input[data-user-quota-input]')
        ).find(function (candidate) {
          return candidate.dataset.userQuotaInput === String(userId);
        });
        const rawValue = input ? input.value.trim() : '';
        dailyQuota = Number(rawValue);

        if (!rawValue || !Number.isInteger(dailyQuota) || dailyQuota < 0 || dailyQuota > 1000000) {
          showAdminNotice('个人每日额度必须是 0 到 1000000 之间的整数。', 'failure');
          return;
        }
      }

      showAdminNotice(resetToGlobal ? '正在恢复全局默认额度…' : '正在保存个人额度…', '');

      try {
        const response = await fetch(
          '/api/miniapp/admin/users/' + encodeURIComponent(userId),
          {
            method: 'PATCH',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ dailyQuota: resetToGlobal ? null : dailyQuota })
          }
        );

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || '额度保存失败');
        }

        await fetchAdminUsers(elements.adminUserSearch.value.trim());
        showAdminNotice(
          resetToGlobal ? '已恢复使用全局默认额度。' : '个人每日额度已保存。',
          'success'
        );

        if (tg && tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('success');
        }
      } catch (error) {
        showAdminNotice(error.message || '额度保存失败。', 'failure');
        if (tg && tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('error');
        }
      }
    }

    async function updateUserCredits(userId) {
      const inputs = Array.from(
        elements.adminUserList.querySelectorAll('input[data-user-credit-input]')
      ).filter(function (candidate) {
        return candidate.dataset.userCreditInput === String(userId);
      });
      const balances = {};

      for (const credit of creditDefinitions) {
        const input = inputs.find(function (candidate) {
          return candidate.dataset.creditType === credit.id;
        });
        const rawValue = input ? input.value.trim() : '';
        const value = Number(rawValue);
        if (
          !rawValue ||
          !Number.isSafeInteger(value) ||
          value < 0 ||
          value > maxAdminCreditBalance
        ) {
          showAdminNotice(
            credit.label + '额度必须是 0 到 ' + maxAdminCreditBalance + ' 之间的整数。',
            'failure'
          );
          return;
        }
        balances[credit.id] = value;
      }

      const accepted = await askConfirmation('确定保存这个账号的六类已购额度余额吗？');
      if (!accepted) return;
      showAdminNotice('正在保存已购额度…', '');

      try {
        const response = await fetch(
          '/api/miniapp/admin/users/' + encodeURIComponent(userId) + '/credits',
          {
            method: 'PATCH',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ operation: 'set', balances: balances })
          }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || '已购额度保存失败');
        }

        await fetchAdminUsers(elements.adminUserSearch.value.trim());
        showAdminNotice('六类已购额度已保存，每日免费额度未改变。', 'success');
        if (tg && tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('success');
        }
      } catch (error) {
        showAdminNotice(error.message || '已购额度保存失败。', 'failure');
        if (tg && tg.HapticFeedback) {
          tg.HapticFeedback.notificationOccurred('error');
        }
      }
    }

    function adminSessionUserLabel(session) {
      const user = session.user || {};
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
      if (name) return name + ' · ID ' + session.userId;
      if (user.username) return '@' + user.username + ' · ID ' + session.userId;
      return '用户 ID ' + session.userId;
    }

    function renderAdminSessions(sessions) {
      state.adminSessions = sessions || [];
      elements.adminSessionList.innerHTML = '';

      state.adminSessions.forEach(function (session) {
        const item = document.createElement('div');
        item.className = 'session-item';

        const title = document.createElement('div');
        const meta = document.createElement('div');
        const actions = document.createElement('div');
        const button = document.createElement('button');

        title.className = 'session-title';
        title.textContent = sessionDisplayName(session) + ' · ' + adminSessionUserLabel(session);

        meta.className = 'session-meta';
        meta.textContent = [
          '聊天 ' + session.chatId,
          '状态 ' + session.status,
          '最近 ' + formatDateTime(session.lastAccessedAt)
        ].join(' · ');

        actions.className = 'session-actions';
        button.type = 'button';
        button.className = 'secondary compact-button';
        button.textContent = '查看摘要';
        button.dataset.adminSessionId = session.id;

        actions.appendChild(button);
        item.appendChild(title);
        item.appendChild(meta);
        item.appendChild(actions);
        elements.adminSessionList.appendChild(item);
      });

      if (!elements.adminSessionList.children.length) {
        const empty = document.createElement('div');
        empty.className = 'notice';
        empty.textContent = '没有找到会话。';
        elements.adminSessionList.appendChild(empty);
      }
    }

    async function fetchAdminSessions(userId) {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (userId) params.set('userId', userId);

      const response = await fetch('/api/miniapp/admin/sessions?' + params.toString(), {
        method: 'GET',
        cache: 'no-store',
        headers: authHeaders()
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || '读取会话概况失败');
      renderAdminSessions(data.items || []);
    }

    async function viewAdminSession(sessionId) {
      showAdminNotice('正在读取会话摘要…', '');

      try {
        const response = await fetch('/api/miniapp/admin/sessions/' + encodeURIComponent(sessionId) + '?limit=50', {
          method: 'GET',
          cache: 'no-store',
          headers: authHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '读取会话摘要失败');

        elements.adminSessionViewerTitle.textContent = sessionDisplayName(data.session || {}) + ' · 用户 ' + data.session.userId;
        renderConversationMessages(elements.adminSessionMessages, data.messages || []);
        elements.adminSessionViewer.classList.remove('hidden');
        hideAdminNotice();
        elements.adminSessionViewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        showAdminNotice(error.message || '读取会话摘要失败。', 'failure');
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
      loadMySessions();
      if (state.profile && state.profile.isAdmin) {
        loadAdmin();
      }
    });

    elements.historyRefreshButton.addEventListener('click', loadMySessions);

    elements.historyClearAllButton.addEventListener('click', clearAllMySessions);

    elements.historySessionList.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-session-action]');
      if (!button) return;
      const sessionId = button.dataset.sessionId;
      if (button.dataset.sessionAction === 'view') viewMySession(sessionId);
      if (button.dataset.sessionAction === 'delete') deleteMySession(sessionId);
    });

    elements.historyViewerClose.addEventListener('click', function () {
      elements.historyViewer.classList.add('hidden');
    });

    elements.adminSearchButton.addEventListener('click', function () {
      fetchAdminUsers(elements.adminUserSearch.value.trim()).catch(function (error) {
        showAdminNotice(error.message || '搜索失败。', 'failure');
      });
    });

    elements.adminUserSearch.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        elements.adminSearchButton.click();
      }
    });

    elements.adminUserList.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-user-id]');
      if (!button || button.disabled) return;
      const action = button.dataset.userAction;
      if (action === 'toggle-block') {
        updateUserBlock(button.dataset.userId, button.dataset.blocked === 'true');
      }
      if (action === 'save-quota') {
        updateUserQuota(button.dataset.userId, false);
      }
      if (action === 'reset-quota') {
        updateUserQuota(button.dataset.userId, true);
      }
      if (action === 'save-credits') {
        updateUserCredits(button.dataset.userId);
      }
    });

    elements.adminSessionSearchButton.addEventListener('click', function () {
      fetchAdminSessions(elements.adminSessionUserSearch.value.trim()).catch(function (error) {
        showAdminNotice(error.message || '筛选会话失败。', 'failure');
      });
    });

    elements.adminSessionUserSearch.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        elements.adminSessionSearchButton.click();
      }
    });

    elements.adminSessionList.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-admin-session-id]');
      if (!button) return;
      viewAdminSession(button.dataset.adminSessionId);
    });

    elements.adminSessionViewerClose.addEventListener('click', function () {
      elements.adminSessionViewer.classList.add('hidden');
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

function verifyTelegramInitData(initData, botToken, maxAgeSeconds = TELEGRAM_AUTH_MAX_AGE_SECONDS) {
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
    nowSeconds - authDate > Math.max(60, Number(maxAgeSeconds) || TELEGRAM_AUTH_MAX_AGE_SECONDS)
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
  const rawIds = config.adminUserIds;
  if (!rawIds) return false;

  if (rawIds instanceof Set) {
    return rawIds.has(String(userId));
  }

  if (Array.isArray(rawIds)) {
    return rawIds.map(String).includes(String(userId));
  }

  if (typeof rawIds[Symbol.iterator] === 'function') {
    return Array.from(rawIds, String).includes(String(userId));
  }

  return false;
}

async function getAuthenticatedUser(req, { db, config }) {
  const initData = getTelegramInitData(req);
  const telegramUser = verifyTelegramInitData(
    initData,
    config.botToken,
    config.miniAppAuthMaxAgeSeconds
  );

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

function buildAdminProviderStatus(config) {
  return PROVIDER_ORDER
    .filter((providerId) => providerId !== 'auto')
    .map((providerId) => ({
      id: providerId,
      label: PROVIDER_LABELS[providerId] || providerId,
      configured: hasProviderCredential(config, providerId),
      current: String(config.aiProvider || '') === providerId,
      modelCount: Array.isArray(config.providerModels?.[providerId])
        ? config.providerModels[providerId].length
        : 0
    }));
}

function resolveAdminUserQuota(db, userId, defaultQuota) {
  const safeDefaultQuota = Math.max(0, Math.trunc(Number(defaultQuota) || 0));

  if (typeof db.getUserDailyQuota !== 'function') {
    return {
      dailyQuota: safeDefaultQuota,
      dailyQuotaOverride: null,
      usesGlobalQuota: true
    };
  }

  const resolved = db.getUserDailyQuota(userId, safeDefaultQuota) || {};
  const override = resolved.dailyQuotaOverride == null
    ? null
    : Math.max(0, Math.trunc(Number(resolved.dailyQuotaOverride) || 0));

  return {
    dailyQuota: Math.max(
      0,
      Math.trunc(Number(resolved.dailyQuota ?? override ?? safeDefaultQuota) || 0)
    ),
    dailyQuotaOverride: override,
    usesGlobalQuota: resolved.usesGlobalQuota !== false && override == null
  };
}

function serializeAdminUser(db, user, defaultQuota = 0) {
  const aiSettings = db.getUserAISettings(user.id);
  const quota = resolveAdminUserQuota(db, user.id, defaultQuota);
  const storedBalances = typeof db.getUserCreditBalances === 'function'
    ? db.getUserCreditBalances(user.id)?.balances || {}
    : {};
  const creditBalances = Object.fromEntries(
    BILLING_CREDIT_TYPES.map((creditType) => [creditType, Number(storedBalances[creditType] || 0)])
  );

  return {
    id: String(user.id),
    username: user.username || '',
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    isAdmin: Boolean(user.isAdmin),
    isBlocked: Boolean(user.isBlocked),
    isAllowed: Boolean(user.isAllowed),
    preferredLanguage: user.preferredLanguage || 'auto',
    persona: user.persona || 'default',
    dailyUsageDate: user.dailyUsageDate || '',
    dailyUsageCount: Number(user.dailyUsageCount || 0),
    dailyQuota: quota.dailyQuota,
    dailyQuotaOverride: quota.dailyQuotaOverride,
    usesGlobalQuota: quota.usesGlobalQuota,
    totalMessages: Number(user.totalMessages || 0),
    lastSeenAt: user.lastSeenAt || '',
    aiProvider: aiSettings.providerId || 'auto',
    aiModel: aiSettings.modelId || '',
    creditBalances
  };
}

function normalizeAdminCreditMutation(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('INVALID_CREDIT_BALANCES');
  }
  const operation = payload.operation == null ? 'set' : String(payload.operation);
  if (operation !== 'set' && operation !== 'adjust') {
    throw new Error('INVALID_CREDIT_OPERATION');
  }

  const field = operation === 'set' ? 'balances' : 'adjustments';
  const values = payload[field];
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('INVALID_CREDIT_BALANCES');
  }
  const keys = Object.keys(values);
  if (
    keys.length === 0 ||
    keys.some((creditType) => !BILLING_CREDIT_TYPES.includes(creditType)) ||
    (operation === 'set' && (
      keys.length !== BILLING_CREDIT_TYPES.length ||
      BILLING_CREDIT_TYPES.some((creditType) => !(creditType in values))
    ))
  ) {
    throw new Error(operation === 'set' ? 'INCOMPLETE_CREDIT_BALANCES' : 'INVALID_CREDIT_BALANCES');
  }

  const normalized = {};
  for (const creditType of keys) {
    const value = values[creditType];
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      (operation === 'set' && value < 0) ||
      Math.abs(value) > MAX_ADMIN_CREDIT_BALANCE
    ) {
      throw new Error('INVALID_CREDIT_BALANCE');
    }
    normalized[creditType] = value;
  }
  return { operation, values: normalized };
}

function serializeSession(session, user = null) {
  return {
    id: String(session.id),
    chatId: String(session.chatId || ''),
    userId: String(session.userId || ''),
    threadId: String(session.threadId || 'main'),
    name: String(session.name || 'main'),
    status: String(session.status || 'active'),
    isDefault: Boolean(session.isDefault),
    lastAccessedAt: session.lastAccessedAt || '',
    createdAt: session.createdAt || '',
    updatedAt: session.updatedAt || '',
    user: user
      ? {
          id: String(user.id),
          username: user.username || '',
          firstName: user.firstName || '',
          lastName: user.lastName || ''
        }
      : undefined
  };
}

function serializeSessionMessages(db, sessionId, limit = 100, maxContentChars = 8000) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const entries = db.getConversationEntries(sessionId, {
    limit: safeLimit,
    order: 'desc'
  });

  return entries.reverse().map((entry) => {
    let content;
    if (typeof entry.content === 'string') {
      content = entry.content;
    } else {
      try {
        content = JSON.stringify(entry.content, null, 2);
      } catch {
        content = String(entry.content || '');
      }
    }

    return {
      role: String(entry.role || ''),
      content: content.slice(0, Math.max(100, Number(maxContentChars) || 8000)),
      model: String(entry.model || ''),
      createdAt: entry.createdAt || ''
    };
  });
}

function logMiniAppSessionAction(context, { actorId, action, targetId = '', details = {}, req }) {
  if (typeof context.db.logAudit !== 'function') return;

  context.db.logAudit({
    actorId: String(actorId),
    actorType: 'telegram_miniapp',
    action,
    targetType: 'session',
    targetId: String(targetId || ''),
    result: 'allow',
    requestId: String(req.headers['x-request-id'] || ''),
    ip: req.socket.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
    details
  });
}

async function handleMiniAppSessionsApi(req, res, context, url) {
  let auth;

  try {
    auth = await getAuthenticatedUser(req, context);
  } catch (error) {
    const response = authErrorResponse(error);
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  const currentUserId = String(auth.telegramUser.id);
  const pathname = url.pathname;

  if (pathname === '/api/miniapp/sessions' && req.method === 'GET') {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const sessions = context.db.listSessions({
      userId: currentUserId,
      status: '',
      limit,
      offset
    });

    sendJson(res, 200, {
      ok: true,
      items: sessions.map((session) => serializeSession(session)),
      limit,
      offset
    });
    return;
  }

  if (pathname === '/api/miniapp/sessions' && req.method === 'DELETE') {
    let deleted = 0;

    while (deleted < 1000) {
      const batch = context.db.listSessions({
        userId: currentUserId,
        status: '',
        limit: 100,
        offset: 0
      });
      if (!batch.length) break;

      for (const session of batch) {
        await context.db.deleteSession(session.id);
        deleted += 1;
      }
    }

    logMiniAppSessionAction(context, {
      actorId: currentUserId,
      action: 'sessions.clear_all',
      details: { deleted },
      req
    });

    sendJson(res, 200, { ok: true, deleted });
    return;
  }

  const match = pathname.match(/^\/api\/miniapp\/sessions\/([^/]+)$/);
  if (match) {
    const sessionId = decodeURIComponent(match[1]);
    const session = context.db.findSession(sessionId);

    if (!session || String(session.userId) !== currentUserId) {
      sendJson(res, 404, {
        ok: false,
        error: 'SESSION_NOT_FOUND',
        message: '没有找到这个会话。'
      });
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        session: serializeSession(session),
        messages: serializeSessionMessages(
          context.db,
          sessionId,
          url.searchParams.get('limit') || 100
        )
      });
      return;
    }

    if (req.method === 'DELETE') {
      await context.db.deleteSession(sessionId);
      logMiniAppSessionAction(context, {
        actorId: currentUserId,
        action: 'sessions.delete',
        targetId: sessionId,
        req
      });
      sendJson(res, 200, { ok: true, deleted: 1 });
      return;
    }
  }

  res.setHeader('Allow', 'GET, DELETE');
  sendJson(res, 404, {
    ok: false,
    error: 'SESSION_ROUTE_NOT_FOUND'
  });
}

async function getAuthenticatedAdmin(req, context) {
  const auth = await getAuthenticatedUser(req, context);
  const configuredAdmin = isAdminUser(context.config, auth.telegramUser.id);
  const databaseAdmin = Boolean(context.db.findUser(auth.telegramUser.id)?.isAdmin);

  if (!configuredAdmin && !databaseAdmin) {
    throw new Error('ADMIN_REQUIRED');
  }

  return auth;
}

function logMiniAppAdminAction(context, {
  actorId,
  action,
  targetId = '',
  details = {},
  req
}) {
  if (typeof context.db.logAudit !== 'function') return;

  context.db.logAudit({
    actorId: String(actorId),
    actorType: 'telegram_miniapp',
    action,
    targetType: targetId ? 'user' : 'admin',
    targetId: String(targetId || ''),
    result: 'allow',
    requestId: String(req.headers['x-request-id'] || ''),
    ip: req.socket.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
    details
  });
}

async function handleMiniAppAdminApi(req, res, context, url) {
  let auth;

  try {
    auth = await getAuthenticatedAdmin(req, context);
  } catch (error) {
    if (String(error?.message) === 'ADMIN_REQUIRED') {
      sendJson(res, 403, {
        ok: false,
        error: 'ADMIN_REQUIRED',
        message: '此账号没有管理员权限。'
      });
      return;
    }

    const response = authErrorResponse(error);
    sendJson(res, response.statusCode, response.payload);
    return;
  }

  const pathname = url.pathname;

  if (pathname === '/api/miniapp/admin/overview' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      totalUsers: context.db.countUsers(),
      dailyQuota: Number(context.config.dailyQuota || 0),
      stats: context.db.getStats(),
      currentProvider: context.config.aiProvider || '',
      currentModel: context.config.defaultModel || '',
      providers: buildAdminProviderStatus(context.config)
    });
    return;
  }

  if (pathname === '/api/miniapp/admin/users' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim();
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const items = context.db
      .listUsers({ q, limit, offset })
      .map((user) => serializeAdminUser(context.db, user, context.config.dailyQuota));

    sendJson(res, 200, {
      ok: true,
      items,
      total: context.db.countUsers({ q }),
      limit,
      offset
    });
    return;
  }

  if (pathname === '/api/miniapp/admin/sessions' && req.method === 'GET') {
    const userId = String(url.searchParams.get('userId') || '').trim();
    const chatId = String(url.searchParams.get('chatId') || '').trim();
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const sessions = context.db.listAdminSessions({
      userId,
      chatId,
      status: '',
      limit,
      offset
    });

    sendJson(res, 200, {
      ok: true,
      items: sessions.map((session) =>
        serializeSession(session, context.db.findUser(session.userId) || null)
      ),
      limit,
      offset
    });
    return;
  }

  const adminSessionMatch = pathname.match(/^\/api\/miniapp\/admin\/sessions\/([^/]+)$/);
  if (adminSessionMatch && req.method === 'GET') {
    const sessionId = decodeURIComponent(adminSessionMatch[1]);
    const session = context.db.findSession(sessionId);

    if (!session) {
      sendJson(res, 404, {
        ok: false,
        error: 'SESSION_NOT_FOUND',
        message: '没有找到这个会话。'
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      session: serializeSession(session, context.db.findUser(session.userId) || null),
      messages: serializeSessionMessages(
        context.db,
        sessionId,
        url.searchParams.get('limit') || 50,
        800
      )
    });
    return;
  }

  const userCreditsMatch = pathname.match(/^\/api\/miniapp\/admin\/users\/([^/]+)\/credits$/);
  if (userCreditsMatch) {
    const targetUserId = decodeURIComponent(userCreditsMatch[1]);
    const targetUser = context.db.findUser(targetUserId);
    if (!targetUser) {
      sendJson(res, 404, {
        ok: false,
        error: 'USER_NOT_FOUND',
        message: '没有找到这个用户。'
      });
      return;
    }

    if (req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        userId: String(targetUserId),
        balances: context.db.getUserCreditBalances(targetUserId).balances
      });
      return;
    }

    if (req.method === 'PATCH') {
      try {
        const mutation = normalizeAdminCreditMutation(await readJsonBody(req));
        if (
          typeof context.db.setUserCreditBalances !== 'function' ||
          typeof context.db.adjustUserCreditBalances !== 'function'
        ) {
          throw new Error('CREDIT_BALANCES_NOT_SUPPORTED');
        }

        if (mutation.operation === 'adjust') {
          const current = context.db.getUserCreditBalances(targetUserId).balances;
          for (const [creditType, delta] of Object.entries(mutation.values)) {
            const next = current[creditType] + delta;
            if (next < 0 || next > MAX_ADMIN_CREDIT_BALANCE) {
              throw new Error(next < 0 ? 'CREDIT_BALANCE_BELOW_ZERO' : 'INVALID_CREDIT_BALANCE');
            }
          }
        }

        const audit = {
          actorId: auth.telegramUser.id,
          actorType: 'telegram_miniapp',
          action: `users.credits.${mutation.operation}`,
          targetType: 'user',
          targetId: String(targetUserId),
          result: 'allow',
          requestId: String(req.headers['x-request-id'] || ''),
          ip: req.socket.remoteAddress || '',
          userAgent: req.headers['user-agent'] || '',
          details: { requestedValues: mutation.values }
        };
        const result = mutation.operation === 'set'
          ? context.db.setUserCreditBalances(targetUserId, mutation.values, {
              audit,
              requireAll: true
            })
          : context.db.adjustUserCreditBalances(targetUserId, mutation.values, { audit });

        sendJson(res, 200, {
          ok: true,
          userId: String(targetUserId),
          operation: result.operation,
          balances: result.balances,
          changes: result.changes,
          user: serializeAdminUser(context.db, context.db.findUser(targetUserId), context.config.dailyQuota)
        });
      } catch (error) {
        const code = String(error?.code || error?.message || 'CREDIT_BALANCE_UPDATE_FAILED');
        const conflict = code === 'CREDIT_BALANCE_BELOW_ZERO' || code === 'CREDIT_BALANCE_OVERFLOW';
        sendJson(res, conflict ? 409 : 400, {
          ok: false,
          error: code,
          message: code === 'CREDIT_BALANCE_BELOW_ZERO'
            ? '已购额度不能调整为负数。'
            : '六类已购额度必须完整填写为 0 到 1000000000 之间的整数。'
        });
      }
      return;
    }

    res.setHeader('Allow', 'GET, PATCH');
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const userMatch = pathname.match(/^\/api\/miniapp\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === 'PATCH') {
    try {
      const targetUserId = decodeURIComponent(userMatch[1]);
      const targetUser = context.db.findUser(targetUserId);

      if (!targetUser) {
        sendJson(res, 404, {
          ok: false,
          error: 'USER_NOT_FOUND',
          message: '没有找到这个用户。'
        });
        return;
      }

      const payload = await readJsonBody(req);
      const hasBlockState = Object.prototype.hasOwnProperty.call(payload, 'isBlocked');
      const hasDailyQuota = Object.prototype.hasOwnProperty.call(payload, 'dailyQuota');

      if (!hasBlockState && !hasDailyQuota) {
        throw new Error('NO_USER_CHANGES');
      }

      if (hasBlockState && typeof payload.isBlocked !== 'boolean') {
        throw new Error('INVALID_BLOCK_STATE');
      }

      if (
        hasDailyQuota &&
        payload.dailyQuota !== null &&
        (
          typeof payload.dailyQuota !== 'number' ||
          !Number.isInteger(payload.dailyQuota) ||
          payload.dailyQuota < 0 ||
          payload.dailyQuota > 1000000
        )
      ) {
        throw new Error('INVALID_DAILY_QUOTA');
      }

      if (
        hasBlockState &&
        payload.isBlocked &&
        String(targetUserId) === String(auth.telegramUser.id)
      ) {
        sendJson(res, 409, {
          ok: false,
          error: 'CANNOT_BLOCK_SELF',
          message: '不能封禁当前管理员账号。'
        });
        return;
      }

      if (hasBlockState && payload.isBlocked && targetUser.isAdmin) {
        sendJson(res, 409, {
          ok: false,
          error: 'CANNOT_BLOCK_ADMIN',
          message: '不能在此页面封禁管理员账号。'
        });
        return;
      }

      let updated = targetUser;

      if (hasBlockState) {
        updated = await context.db.setUserSettings(targetUserId, {
          isBlocked: payload.isBlocked
        });
      }

      if (hasDailyQuota) {
        if (
          typeof context.db.setUserDailyQuota !== 'function' ||
          typeof context.db.clearUserDailyQuota !== 'function'
        ) {
          throw new Error('DAILY_QUOTA_NOT_SUPPORTED');
        }

        if (payload.dailyQuota === null) {
          await context.db.clearUserDailyQuota(targetUserId, context.config.dailyQuota);
        } else {
          await context.db.setUserDailyQuota(
            targetUserId,
            payload.dailyQuota,
            context.config.dailyQuota
          );
        }

        updated = context.db.findUser(targetUserId) || updated;
      }

      const action = hasBlockState && hasDailyQuota
        ? 'users.update'
        : hasDailyQuota
          ? payload.dailyQuota === null
            ? 'users.quota.reset'
            : 'users.quota.set'
          : payload.isBlocked
            ? 'users.block'
            : 'users.unblock';

      logMiniAppAdminAction(context, {
        actorId: auth.telegramUser.id,
        action,
        targetId: targetUserId,
        details: {
          ...(hasBlockState ? { isBlocked: payload.isBlocked } : {}),
          ...(hasDailyQuota ? { dailyQuota: payload.dailyQuota } : {})
        },
        req
      });

      sendJson(res, 200, {
        ok: true,
        user: serializeAdminUser(context.db, updated, context.config.dailyQuota)
      });
    } catch (error) {
      const code = String(error?.message || 'ADMIN_USER_UPDATE_FAILED');
      sendJson(res, 400, {
        ok: false,
        error: code,
        message: code === 'INVALID_DAILY_QUOTA'
          ? '个人每日额度必须是 0 到 1000000 之间的整数，null 表示恢复全局默认。'
          : '用户设置更新失败。'
      });
    }
    return;
  }

  res.setHeader('Allow', 'GET, PATCH');
  sendJson(res, 404, {
    ok: false,
    error: 'ADMIN_ROUTE_NOT_FOUND'
  });
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

      if (pathname === '/api/miniapp/sessions' || pathname.startsWith('/api/miniapp/sessions/')) {
        await handleMiniAppSessionsApi(req, res, context, url);
        return;
      }

      if (pathname.startsWith('/api/miniapp/admin/')) {
        await handleMiniAppAdminApi(req, res, context, url);
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
        availableRoutes: [
          '/',
          '/app',
          '/api/miniapp/settings',
          '/api/miniapp/sessions',
          '/api/miniapp/sessions/:id',
          '/api/miniapp/admin/overview',
          '/api/miniapp/admin/users',
          '/api/miniapp/admin/users/:id/credits',
          '/api/miniapp/admin/sessions',
          '/health',
          '/ready'
        ]
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
      routes: [
        '/',
        '/app',
        '/api/miniapp/settings',
        '/api/miniapp/sessions',
        '/api/miniapp/sessions/:id',
        '/api/miniapp/admin/overview',
        '/api/miniapp/admin/users',
        '/api/miniapp/admin/users/:id/credits',
        '/api/miniapp/admin/sessions',
        '/health',
        '/ready'
      ]
    });
  });

  return server;
}
