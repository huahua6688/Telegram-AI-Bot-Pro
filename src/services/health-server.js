import { buildUserBillingSnapshot } from './billing-catalog.js';
import crypto from 'node:crypto';
import http from 'node:http';
import { getBuildInfo } from '../app/build-info.js';
import { BILLING_CREDIT_TYPES } from '../db.js';
import {
  buildBillingCatalog,
  getDefaultChatFreeQuota
} from './billing-catalog.js';
import { resolveSupportContactUrl } from './support-contact.js';
import { serializeAdminUser } from './admin-user-serializer.js';
import {
  isValidNewsLanguage,
  isValidNewsRegion,
  isValidNewsTimeZone,
  normalizeNewsLanguage,
  normalizeNewsRegion,
  normalizeNewsTimeZone,
  resolveEffectiveNewsSettings
} from '../utils/news-settings.js';

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

const NEWS_REGION_OPTIONS = [
  { id: 'CN', label: '中国大陆' },
  { id: 'HK', label: '香港' },
  { id: 'TW', label: '台湾' },
  { id: 'MO', label: '澳门' },
  { id: 'MY', label: '马来西亚' },
  { id: 'SG', label: '新加坡' },
  { id: 'ID', label: '印度尼西亚' },
  { id: 'KH', label: '柬埔寨' },
  { id: 'JP', label: '日本' },
  { id: 'KR', label: '韩国' },
  { id: 'TH', label: '泰国' },
  { id: 'VN', label: '越南' },
  { id: 'US', label: '美国' },
  { id: 'GB', label: '英国' },
  { id: 'AU', label: '澳大利亚' },
  { id: 'CA', label: '加拿大' }
];

const NEWS_LANGUAGE_OPTIONS = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-HK', label: '香港繁体中文' },
  { id: 'zh-TW', label: '台湾繁体中文' },
  { id: 'en', label: 'English' },
  { id: 'ms-MY', label: 'Bahasa Melayu' },
  { id: 'id-ID', label: 'Bahasa Indonesia' },
  { id: 'km-KH', label: 'ភាសាខ្មែរ' },
  { id: 'ja-JP', label: '日本語' },
  { id: 'ko-KR', label: '한국어' },
  { id: 'th-TH', label: 'ไทย' },
  { id: 'vi-VN', label: 'Tiếng Việt' }
];

const NEWS_TIME_ZONE_OPTIONS = [
  { id: 'Asia/Shanghai', label: '中国大陆（上海）' },
  { id: 'Asia/Hong_Kong', label: '香港' },
  { id: 'Asia/Taipei', label: '台湾（台北）' },
  { id: 'Asia/Macau', label: '澳门' },
  { id: 'Asia/Kuala_Lumpur', label: '马来西亚（吉隆坡）' },
  { id: 'Asia/Singapore', label: '新加坡' },
  { id: 'Asia/Jakarta', label: '印度尼西亚西部（雅加达）' },
  { id: 'Asia/Makassar', label: '印度尼西亚中部（望加锡）' },
  { id: 'Asia/Jayapura', label: '印度尼西亚东部（查亚普拉）' },
  { id: 'Asia/Phnom_Penh', label: '柬埔寨（金边）' },
  { id: 'Asia/Tokyo', label: '日本（东京）' },
  { id: 'Asia/Seoul', label: '韩国（首尔）' },
  { id: 'Asia/Bangkok', label: '泰国（曼谷）' },
  { id: 'Asia/Ho_Chi_Minh', label: '越南（胡志明市）' },
  { id: 'Europe/London', label: '英国（伦敦）' },
  { id: 'America/New_York', label: '美国东部（纽约）' },
  { id: 'America/Chicago', label: '美国中部（芝加哥）' },
  { id: 'America/Denver', label: '美国山地（丹佛）' },
  { id: 'America/Los_Angeles', label: '美国西部（洛杉矶）' },
  { id: 'Australia/Sydney', label: '澳大利亚东部（悉尼）' },
  { id: 'UTC', label: 'UTC' }
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
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      overflow: hidden;
      background: var(--tg-theme-bg-color, #f3f4f6);
      color: var(--tg-theme-text-color, #111827);
      -webkit-tap-highlight-color: transparent;
    }

    .shell {
      width: min(100%, 640px);
      height: 100vh;
      height: 100dvh;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--tg-theme-bg-color, #f3f4f6);
    }

    .app-header {
      z-index: 20;
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 50px;
      padding: max(8px, env(safe-area-inset-top)) 14px 8px;
      border-bottom: 1px solid rgba(127, 127, 127, .14);
      background: var(--tg-theme-bg-color, #f3f4f6);
      background: color-mix(in srgb, var(--tg-theme-bg-color, #f3f4f6) 88%, transparent);
      backdrop-filter: blur(20px) saturate(160%);
      -webkit-backdrop-filter: blur(20px) saturate(160%);
    }

    .app-title {
      min-width: 0;
      overflow: hidden;
      font-size: 17px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-close {
      width: auto;
      min-height: 34px;
      padding: 6px 8px;
      border-radius: 10px;
      color: var(--tg-theme-button-color, #2481cc);
      background: transparent;
      font-size: 14px;
    }

    .app-content {
      flex: 1 1 auto;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior-y: contain;
      padding: 14px 14px 22px;
      scroll-behavior: smooth;
      -webkit-overflow-scrolling: touch;
    }

    .app-view { display: none; }
    .app-view.active { display: block; animation: view-in .18s ease-out; }

    @keyframes view-in {
      from { opacity: .55; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .bottom-nav {
      z-index: 20;
      flex: 0 0 auto;
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      gap: 2px;
      padding: 7px 8px max(7px, env(safe-area-inset-bottom));
      border-top: 1px solid rgba(127, 127, 127, .16);
      background: var(--tg-theme-secondary-bg-color, #ffffff);
      background: color-mix(in srgb, var(--tg-theme-secondary-bg-color, #ffffff) 90%, transparent);
      backdrop-filter: blur(22px) saturate(170%);
      -webkit-backdrop-filter: blur(22px) saturate(170%);
    }

    .nav-button {
      display: grid;
      place-items: center;
      gap: 2px;
      min-height: 49px;
      padding: 4px 2px;
      border-radius: 12px;
      color: var(--tg-theme-hint-color, #6b7280);
      background: transparent;
      font-size: 10px;
      font-weight: 700;
    }

    .nav-button svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.9;
    }

    .nav-button.active {
      color: var(--tg-theme-button-color, #2481cc);
      background: rgba(36, 129, 204, .08);
    }

    .page-heading { display: none; }

    .welcome-line {
      margin: 0 2px 10px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 13px;
      line-height: 1.45;
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
      margin-top: 10px;
      padding: 16px;
      border: 1px solid rgba(127, 127, 127, .11);
      border-radius: 17px;
      background: var(--tg-theme-secondary-bg-color, #ffffff);
      box-shadow: 0 6px 22px rgba(0, 0, 0, .04);
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

    select,
    input[list] {
      box-sizing: border-box;
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

    select:focus,
    input[list]:focus {
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

    .status-row > * { min-width: 0; }

    .feature-action {
      grid-column: 1 / -1;
      min-height: 52px;
      border: 1px solid rgba(36, 129, 204, .28);
      box-shadow: 0 6px 18px rgba(36, 129, 204, .12);
    }

    .support-action {
      color: var(--tg-theme-button-color, #2481cc);
      background: rgba(36, 129, 204, .09);
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

    .admin-section {
      margin-top: 14px;
      border: 1px solid rgba(127, 127, 127, .16);
      border-radius: 16px;
      background: var(--tg-theme-secondary-bg-color, #ffffff);
      overflow: hidden;
    }

    .admin-section > summary {
      min-height: 50px;
      padding: 15px 16px;
      cursor: pointer;
      font-size: 15px;
      font-weight: 800;
      list-style: none;
    }

    .admin-section > summary::-webkit-details-marker { display: none; }
    .admin-section > summary::after { content: '›'; float: right; color: var(--tg-theme-hint-color, #6b7280); transform: rotate(90deg); }
    .admin-section[open] > summary::after { transform: rotate(-90deg); }
    .admin-section-body { padding: 0 14px 14px; }

    .admin-tabs {
      position: sticky;
      top: -14px;
      z-index: 5;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px;
      margin: -2px 0 12px;
      padding: 4px;
      border-radius: 13px;
      background: rgba(127, 127, 127, .12);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }

    .admin-tab {
      min-height: 38px;
      padding: 7px 8px;
      border-radius: 10px;
      color: var(--tg-theme-hint-color, #6b7280);
      background: transparent;
      font-size: 13px;
    }

    .admin-tab.active {
      color: var(--tg-theme-text-color, #111827);
      background: var(--tg-theme-secondary-bg-color, #ffffff);
      box-shadow: 0 2px 8px rgba(0, 0, 0, .07);
    }

    .admin-pane { display: none; }
    .admin-pane.active { display: block; }

    .settings-details {
      margin-top: 16px;
      border-top: 1px solid rgba(127, 127, 127, .16);
      border-bottom: 1px solid rgba(127, 127, 127, .16);
    }

    .settings-details > summary {
      padding: 14px 2px;
      cursor: pointer;
      color: var(--tg-theme-button-color, #2481cc);
      font-size: 14px;
      font-weight: 800;
      list-style: none;
    }

    .settings-details > summary::-webkit-details-marker { display: none; }
    .settings-details > summary::after { content: '›'; float: right; transition: transform .18s; }
    .settings-details[open] > summary::after { transform: rotate(90deg); }
    .settings-details-body { padding: 0 2px 14px; }

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

    .admin-filters {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 10px;
    }

    .result-bar,
    .pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
    }

    .pagination > span { flex: 0 0 auto; white-space: nowrap; }

    .result-bar { margin: 4px 2px 10px; }
    .page-size-control {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .page-size-control select {
      width: auto;
      min-height: 32px;
      padding: 0 26px 0 8px;
      border-radius: 9px;
      font-size: 12px;
    }
    .pagination { margin-top: 12px; }
    .pagination button { min-width: 76px; }

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

    .user-head > div,
    .session-item,
    .provider-item > div { min-width: 0; }

    .user-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 72px;
    }

    .user-item .user-head { min-width: 0; }
    .user-item .user-actions { margin: 0; }

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

    .balance-grid,
    .product-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .balance-item,
    .product-item {
      padding: 13px;
      border-radius: 14px;
      background: var(--tg-theme-bg-color, #f9fafb);
    }

    .balance-item strong,
    .product-item strong {
      display: block;
      margin-bottom: 5px;
    }

    .balance-item span,
    .product-item span,
    .product-item p {
      color: var(--tg-theme-hint-color, #6b7280);
      font-size: 12px;
      line-height: 1.55;
    }

    .product-item p { margin: 6px 0 0; }

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

      .balance-grid,
      .product-list {
        grid-template-columns: 1fr;
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

    .sheet-backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding-top: env(safe-area-inset-top);
      background: rgba(0, 0, 0, .32);
    }

    .sheet-backdrop.hidden { display: none; }

    .sheet-panel {
      width: min(100%, 640px);
      max-height: min(88dvh, 760px);
      overflow: hidden;
      border-radius: 22px 22px 0 0;
      background: var(--tg-theme-secondary-bg-color, #ffffff);
      box-shadow: 0 -16px 42px rgba(0, 0, 0, .2);
    }

    .sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px 10px;
      border-bottom: 1px solid rgba(127, 127, 127, .15);
    }

    .sheet-head strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sheet-body { max-height: calc(min(88dvh, 760px) - 60px); overflow-y: auto; padding: 4px 16px max(18px, env(safe-area-inset-bottom)); }
    .sheet-body .conversation-viewer { margin: 0; padding: 10px 0 0; background: transparent; }

    .sheet-close {
      width: auto;
      min-height: 34px;
      padding: 6px 9px;
      color: var(--tg-theme-button-color, #2481cc);
      background: rgba(36, 129, 204, .1);
      font-size: 13px;
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

    @media (hover: hover) and (pointer: fine) {
      button:not(:disabled):hover { filter: brightness(.97); }
      .nav-button:not(.active):hover,
      .admin-tab:not(.active):hover { background: rgba(127, 127, 127, .08); }
    }

    @media (min-width: 840px) {
      body { background: #e8ebf0; }

      .shell {
        width: min(100%, 1280px);
        display: grid;
        grid-template-columns: clamp(188px, 18vw, 224px) minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
        box-shadow: 0 0 50px rgba(0, 0, 0, .12);
      }

      .app-header {
        grid-column: 1 / -1;
        grid-row: 1;
        padding-right: 22px;
        padding-left: 22px;
      }

      .app-content {
        grid-column: 2;
        grid-row: 2;
        padding: clamp(20px, 3vw, 34px);
        scrollbar-gutter: stable;
      }

      .app-view.active {
        width: min(100%, 920px);
        margin: 0 auto;
      }

      .app-view[data-view="admin"].active { width: 100%; }

      .bottom-nav {
        grid-column: 1;
        grid-row: 2;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        gap: 5px;
        padding: 18px 12px;
        border-top: 0;
        border-right: 1px solid rgba(127, 127, 127, .16);
      }

      .nav-button {
        grid-template-columns: 28px minmax(0, 1fr);
        place-items: center start;
        gap: 10px;
        min-height: 46px;
        padding: 8px 12px;
        text-align: left;
        font-size: 14px;
      }

      .nav-button svg { width: 21px; height: 21px; }
      .stats-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }

      .sheet-backdrop {
        align-items: center;
        padding: 24px;
      }

      .sheet-panel {
        width: min(720px, 100%);
        max-height: min(84dvh, 780px);
        border-radius: 22px;
      }

      .sheet-body { max-height: calc(min(84dvh, 780px) - 60px); }
    }

    @media (min-width: 1120px) {
      .admin-pane[data-admin-pane="users"] .user-list,
      .admin-pane[data-admin-pane="sessions"] .session-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 639px) {
      select,
      input[list],
      input[type="search"],
      input[type="number"] { font-size: 16px; }

      .admin-filters { grid-template-columns: 1fr; }
    }

    @media (max-width: 390px) {
      .app-content { padding-right: 10px; padding-left: 10px; }
      .nav-button { font-size: 9px; }
      .card { padding: 14px; }
      .status-row { gap: 10px; }
      .value { max-width: 60%; }
      .pagination button { min-width: 68px; padding-right: 9px; padding-left: 9px; }
    }

    @media (max-width: 340px) {
      .actions { grid-template-columns: 1fr; }
      .feature-action { grid-column: auto; }
      .stats-grid { grid-template-columns: 1fr; }
      .app-content { padding-right: 8px; padding-left: 8px; }
      .bottom-nav { padding-right: 4px; padding-left: 4px; }
      .nav-button svg { width: 20px; height: 20px; }
    }

    @media (max-height: 560px) and (max-width: 839px) {
      .app-header { min-height: 44px; padding-top: 5px; padding-bottom: 5px; }
      .bottom-nav { padding-top: 4px; padding-bottom: max(4px, env(safe-area-inset-bottom)); }
      .nav-button { min-height: 43px; }
      .nav-button svg { width: 19px; height: 19px; }
      .app-content { padding-top: 10px; padding-bottom: 12px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .01ms !important;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="app-header">
      <strong class="app-title" id="appTitle">控制台</strong>
      <button class="header-close" id="closeButton" type="button">完成</button>
    </header>

    <div class="app-content" id="appContent">
    <section class="app-view active" id="homeView" data-view="home">
      <p class="welcome-line" id="welcome">正在连接 Telegram 和 Bot 服务……</p>

    <section class="card">
      <div class="section-head">
        <h2>运行状态</h2>
        <span class="badge" id="statusBadge">检查中</span>
      </div>
      <div class="status-row">
        <span class="label">我的 AI 平台</span>
        <span class="value" id="provider">—</span>
      </div>
      <div class="status-row">
        <span class="label">我的当前模型</span>
        <span class="value" id="model">—</span>
      </div>
      <div class="status-row">
        <span class="label">运行时间</span>
        <span class="value" id="uptime">—</span>
      </div>
      <div class="status-row">
        <span class="label">我的已处理消息</span>
        <span class="value" id="messages">—</span>
      </div>
      <div class="status-row">
        <span class="label">我的 AI 调用</span>
        <span class="value" id="aiCalls">—</span>
      </div>
    </section>
    </section>

    <section class="app-view" id="settingsView" data-view="settings">
      <div class="page-heading">
        <h1>AI 设置</h1>
        <p>选择平台、模型、语言与回答风格。</p>
      </div>

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
          <label for="providerSelect">AI 平台</label>
          <select id="providerSelect" disabled>
            <option value="">加载中…</option>
          </select>
        </div>

        <div class="field">
          <label for="modelSelect">AI 模型</label>
          <select id="modelSelect" disabled>
            <option value="">加载中…</option>
          </select>
          <p class="small hidden" id="modelDescription" style="text-align:left;margin-top:8px"></p>
        </div>

        <div class="field">
          <label for="languageSelect">设置语言（Language）</label>
          <select id="languageSelect" disabled></select>
        </div>

        <details class="settings-details">
          <summary>新闻与地区高级设置</summary>
          <div class="settings-details-body">
            <div class="field">
              <label for="newsRegionSelect">新闻地区（可选）</label>
              <input id="newsRegionSelect" list="newsRegionOptions" maxlength="2" autocomplete="off"
                placeholder="自动继承，也可输入 DE" disabled />
              <datalist id="newsRegionOptions"></datalist>
            </div>

            <div class="field">
              <label for="newsLanguageSelect">新闻语言（可选）</label>
              <input id="newsLanguageSelect" list="newsLanguageOptions" maxlength="35" autocomplete="off"
                placeholder="自动继承，也可输入 de-DE" disabled />
              <datalist id="newsLanguageOptions"></datalist>
            </div>

            <div class="field">
              <label for="newsTimeZoneSelect">新闻时区（可选）</label>
              <input id="newsTimeZoneSelect" list="newsTimeZoneOptions" maxlength="64" autocomplete="off"
                placeholder="自动继承，也可输入 Europe/Berlin" disabled />
              <datalist id="newsTimeZoneOptions"></datalist>
            </div>

            <p class="small" id="newsEffectiveLabel">
              未单独设置时，会根据你的语言判断；无法可靠判断时才使用服务器默认值。
            </p>
          </div>
        </details>

        <div class="field">
          <label for="personaSelect">回答风格</label>
          <select id="personaSelect" disabled></select>
        </div>

        <div class="switch-row">
          <div class="switch-copy">
            <strong>故障时自动切换</strong>
            <span>免费平台额度不足、限流或不可用时，依次切换备用平台，最后使用已配置的付费 API。</span>
          </div>
          <label class="switch">
            <input id="fallbackToggle" type="checkbox" disabled />
            <span class="slider"></span>
          </label>
        </div>

        <div id="settingsNotice" class="notice hidden"></div>

        <div class="actions">
          <button class="primary" id="saveButton" type="submit" disabled>保存</button>
          <button class="secondary" id="refreshButton" type="button">重新载入</button>
          <button class="primary feature-action hidden" id="syncModelsButton" type="button">🔄 获取 AI Hub 最新模型</button>
        </div>
      </form>
    </section>
    </section>

    <section class="app-view" id="billingView" data-view="billing">
      <div class="page-heading">
        <h1>余额与额度</h1>
        <p>查看每日免费额度、已购余额和 Stars 套餐。</p>
      </div>

    <section class="card" id="billingPanel">
      <div class="section-head">
        <h2>我的余额与用量</h2>
        <span class="badge" id="billingBadge">读取中</span>
      </div>
      <p class="small" style="text-align:left;margin-top:0">
        每项能力先使用当天免费额度，再使用已购余额；失败请求会自动归还。
      </p>
      <div class="balance-grid" id="billingSummary"></div>
      <div class="subsection">
        <h3 class="subsection-title">可购买额度包</h3>
        <div class="product-list" id="productList"></div>
        <p class="small" id="purchaseHint" style="text-align:left">付款请回到机器人，点击输入框下方的“⭐ 购买额度”。</p>
        <div class="actions">
          <button class="secondary feature-action support-action hidden" id="supportButton" type="button">🧑‍💻 联系人工客服</button>
        </div>
      </div>
    </section>
    </section>

    <section class="app-view" id="historyView" data-view="history">
      <div class="page-heading">
        <h1>聊天记录</h1>
        <p>按会话查看机器人保留的上下文和回答。</p>
      </div>

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

    </section>

    <section class="app-view" id="adminView" data-view="admin">
      <div class="page-heading">
        <h1>管理中心</h1>
        <p>管理平台状态、用户额度和会话数据。</p>
      </div>

    <section class="card hidden" id="adminPanel">
      <div id="adminNotice" class="notice hidden"></div>

      <div class="stats-grid">
        <div class="stat-box">
          <span>用户总数</span>
          <strong id="adminTotalUsers">—</strong>
        </div>
        <div class="stat-box">
          <span>每日免费聊天</span>
          <strong id="adminDailyQuota">—</strong>
        </div>
        <div class="stat-box">
          <span>全站已处理消息</span>
          <strong id="adminMessages">—</strong>
        </div>
        <div class="stat-box">
          <span>全站 AI 调用</span>
          <strong id="adminAiCalls">—</strong>
        </div>
      </div>

      <div class="admin-tabs" role="tablist" aria-label="管理分类">
        <button class="admin-tab active" type="button" data-admin-pane-target="overview">概览</button>
        <button class="admin-tab" type="button" data-admin-pane-target="users">用户</button>
        <button class="admin-tab" type="button" data-admin-pane-target="sessions">会话</button>
      </div>

      <div class="admin-pane active" data-admin-pane="overview">
        <details class="admin-section" open>
          <summary>全局默认模型</summary>
          <div class="admin-section-body">
            <p class="small" style="text-align:left;margin-top:0">只影响使用“自动”模式的用户，不覆盖任何用户手动选择的模型。</p>
            <div class="field-grid">
              <label>默认平台<select id="adminGlobalProvider"></select></label>
              <label>默认模型<select id="adminGlobalModel"></select></label>
            </div>
            <p class="small" id="adminGlobalModelSource" style="text-align:left"></p>
            <div class="actions">
              <button class="primary compact-button" id="adminGlobalModelSave" type="button">保存全局默认值</button>
              <button class="secondary compact-button" id="adminGlobalModelReset" type="button">恢复环境变量</button>
            </div>
          </div>
        </details>
        <details class="admin-section">
          <summary>AI 平台状态</summary>
          <div class="admin-section-body"><div class="provider-list" id="adminProviderList"></div></div>
        </details>
      </div>

      <div class="admin-pane" data-admin-pane="users">
        <div class="admin-toolbar">
          <input id="adminUserSearch" type="search" placeholder="搜索 ID、用户名或姓名" />
          <button class="secondary compact-button" id="adminSearchButton" type="button">搜索</button>
        </div>
        <div class="admin-filters">
          <select id="adminUserStatus" aria-label="用户状态">
            <option value="all">全部状态</option><option value="active">正常用户</option>
            <option value="blocked">已封禁</option><option value="admin">管理员</option>
          </select>
          <select id="adminUserSort" aria-label="用户排序">
            <option value="recent">最近活跃</option><option value="usage">使用最多</option>
            <option value="name">用户名</option><option value="oldest">最早注册</option>
          </select>
        </div>
        <div class="result-bar"><span id="adminUserResult">—</span><label class="page-size-control">每页<select id="adminUserPageSize" aria-label="每页用户数"><option value="20">20 人</option><option value="50">50 人</option><option value="100">100 人</option></select></label></div>
        <div class="user-list" id="adminUserList"></div>
        <div class="pagination">
          <button class="secondary compact-button" id="adminUserPrev" type="button">上一页</button>
          <span id="adminUserPage">—</span>
          <button class="secondary compact-button" id="adminUserNext" type="button">下一页</button>
        </div>
      </div>

      <div class="admin-pane" data-admin-pane="sessions">
        <div class="admin-toolbar">
          <input id="adminSessionSearch" type="search" placeholder="搜索用户、会话、聊天 ID" />
          <button class="secondary compact-button" id="adminSessionSearchButton" type="button">搜索</button>
        </div>
        <div class="admin-filters">
          <select id="adminSessionStatus" aria-label="会话状态">
            <option value="">全部状态</option><option value="active">活跃</option><option value="archived">已归档</option>
          </select>
          <select id="adminSessionSort" aria-label="会话排序">
            <option value="recent">最近更新</option><option value="oldest">最早更新</option>
          </select>
        </div>
        <div class="result-bar"><span id="adminSessionResult">—</span><label class="page-size-control">每页<select id="adminSessionPageSize" aria-label="每页会话数"><option value="20">20 个</option><option value="50">50 个</option><option value="100">100 个</option></select></label></div>
        <div class="session-list" id="adminSessionList"></div>
        <div class="pagination">
          <button class="secondary compact-button" id="adminSessionPrev" type="button">上一页</button>
          <span id="adminSessionPage">—</span>
          <button class="secondary compact-button" id="adminSessionNext" type="button">下一页</button>
        </div>
      </div>
    </section>
    </section>
    </div>

    <nav class="bottom-nav" aria-label="控制台导航">
      <button class="nav-button active" type="button" data-view-target="home" aria-current="page">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9h13v-9"/><path d="M9.5 19v-5h5v5"/></svg><span>首页</span>
      </button>
      <button class="nav-button" type="button" data-view-target="settings">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.3 3.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.3 3.1h5l.3-3.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/></svg><span>设置</span>
      </button>
      <button class="nav-button" type="button" data-view-target="billing">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.9Z"/></svg><span>额度</span>
      </button>
      <button class="nav-button" type="button" data-view-target="history">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 3Z"/><path d="M8 9h8M8 12h5"/></svg><span>记录</span>
      </button>
      <button class="nav-button hidden" id="adminNavButton" type="button" data-view-target="admin">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6Z"/><path d="m9 12 2 2 4-4"/></svg><span>管理</span>
      </button>
    </nav>

    <div class="sheet-backdrop hidden" id="adminUserSheet" role="dialog" aria-modal="true" aria-labelledby="adminUserSheetTitle">
      <div class="sheet-panel">
        <div class="sheet-head"><strong id="adminUserSheetTitle">用户详情</strong><button class="sheet-close" id="adminUserSheetClose" type="button">关闭</button></div>
        <div class="sheet-body" id="adminUserSheetBody"></div>
      </div>
    </div>

    <div class="sheet-backdrop hidden" id="adminSessionSheet" role="dialog" aria-modal="true" aria-labelledby="adminSessionViewerTitle">
      <div class="sheet-panel">
        <div class="sheet-head"><strong id="adminSessionViewerTitle">会话摘要</strong><button class="sheet-close" id="adminSessionViewerClose" type="button">关闭</button></div>
        <div class="sheet-body"><div class="conversation-viewer"><div class="conversation-messages" id="adminSessionMessages"></div></div></div>
      </div>
    </div>
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
      { id: 'live_voice', label: '语音转写' },
      { id: 'video', label: '视频' }
    ];
    const maxAdminCreditBalance = 1000000000;

    const state = {
      catalog: [],
      settings: null,
      routing: null,
      profile: null,
      activeView: 'home',
      historyLoaded: false,
      sessions: [],
      adminLoaded: false,
      adminUsers: [],
      adminSessions: [],
      adminUsersLoaded: false,
      adminSessionsLoaded: false,
      adminUserPage: 0,
      adminUserTotal: 0,
      adminSelectedUserId: '',
      adminSessionPage: 0,
      adminSessionTotal: 0,
      adminUserPageSize: 20,
      adminSessionPageSize: 20,
      adminUserRequestId: 0,
      adminSessionRequestId: 0,
      adminProviders: [],
      adminGlobalAISettings: null,
      supportUrl: ''
    };
    let adminUserSearchTimer = null;
    let adminSessionSearchTimer = null;

    const elements = {
      appContent: document.getElementById('appContent'),
      appTitle: document.getElementById('appTitle'),
      appViews: Array.from(document.querySelectorAll('.app-view')),
      viewButtons: Array.from(document.querySelectorAll('[data-view-target]')),
      navButtons: Array.from(document.querySelectorAll('.nav-button')),
      adminNavButton: document.getElementById('adminNavButton'),
      welcome: document.getElementById('welcome'),
      statusBadge: document.getElementById('statusBadge'),
      provider: document.getElementById('provider'),
      model: document.getElementById('model'),
      uptime: document.getElementById('uptime'),
      messages: document.getElementById('messages'),
      aiCalls: document.getElementById('aiCalls'),
      billingBadge: document.getElementById('billingBadge'),
      billingSummary: document.getElementById('billingSummary'),
      productList: document.getElementById('productList'),
      purchaseHint: document.getElementById('purchaseHint'),
      supportButton: document.getElementById('supportButton'),
      userIdLabel: document.getElementById('userIdLabel'),
      telegramRequired: document.getElementById('telegramRequired'),
      settingsForm: document.getElementById('settingsForm'),
      providerSelect: document.getElementById('providerSelect'),
      modelSelect: document.getElementById('modelSelect'),
      languageSelect: document.getElementById('languageSelect'),
      newsRegionSelect: document.getElementById('newsRegionSelect'),
      newsRegionOptions: document.getElementById('newsRegionOptions'),
      newsLanguageSelect: document.getElementById('newsLanguageSelect'),
      newsLanguageOptions: document.getElementById('newsLanguageOptions'),
      newsTimeZoneSelect: document.getElementById('newsTimeZoneSelect'),
      newsTimeZoneOptions: document.getElementById('newsTimeZoneOptions'),
      newsEffectiveLabel: document.getElementById('newsEffectiveLabel'),
      personaSelect: document.getElementById('personaSelect'),
      fallbackToggle: document.getElementById('fallbackToggle'),
      settingsNotice: document.getElementById('settingsNotice'),
      saveButton: document.getElementById('saveButton'),
      refreshButton: document.getElementById('refreshButton'),
      syncModelsButton: document.getElementById('syncModelsButton'),
      modelDescription: document.getElementById('modelDescription'),
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
      adminGlobalProvider: document.getElementById('adminGlobalProvider'),
      adminGlobalModel: document.getElementById('adminGlobalModel'),
      adminGlobalModelSource: document.getElementById('adminGlobalModelSource'),
      adminGlobalModelSave: document.getElementById('adminGlobalModelSave'),
      adminGlobalModelReset: document.getElementById('adminGlobalModelReset'),
      adminProviderList: document.getElementById('adminProviderList'),
      adminTabs: Array.from(document.querySelectorAll('[data-admin-pane-target]')),
      adminPanes: Array.from(document.querySelectorAll('[data-admin-pane]')),
      adminUserSearch: document.getElementById('adminUserSearch'),
      adminUserStatus: document.getElementById('adminUserStatus'),
      adminUserSort: document.getElementById('adminUserSort'),
      adminSearchButton: document.getElementById('adminSearchButton'),
      adminUserList: document.getElementById('adminUserList'),
      adminUserResult: document.getElementById('adminUserResult'),
      adminUserPageSize: document.getElementById('adminUserPageSize'),
      adminUserPage: document.getElementById('adminUserPage'),
      adminUserPrev: document.getElementById('adminUserPrev'),
      adminUserNext: document.getElementById('adminUserNext'),
      adminUserSheet: document.getElementById('adminUserSheet'),
      adminUserSheetTitle: document.getElementById('adminUserSheetTitle'),
      adminUserSheetBody: document.getElementById('adminUserSheetBody'),
      adminUserSheetClose: document.getElementById('adminUserSheetClose'),
      adminSessionSearch: document.getElementById('adminSessionSearch'),
      adminSessionStatus: document.getElementById('adminSessionStatus'),
      adminSessionSort: document.getElementById('adminSessionSort'),
      adminSessionSearchButton: document.getElementById('adminSessionSearchButton'),
      adminSessionList: document.getElementById('adminSessionList'),
      adminSessionResult: document.getElementById('adminSessionResult'),
      adminSessionPageSize: document.getElementById('adminSessionPageSize'),
      adminSessionPage: document.getElementById('adminSessionPage'),
      adminSessionPrev: document.getElementById('adminSessionPrev'),
      adminSessionNext: document.getElementById('adminSessionNext'),
      adminSessionSheet: document.getElementById('adminSessionSheet'),
      adminSessionViewerTitle: document.getElementById('adminSessionViewerTitle'),
      adminSessionViewerClose: document.getElementById('adminSessionViewerClose'),
      adminSessionMessages: document.getElementById('adminSessionMessages'),
      closeButton: document.getElementById('closeButton')
    };

    const viewTitles = {
      home: '控制台',
      settings: 'AI 设置',
      billing: '余额与额度',
      history: '聊天记录',
      admin: '管理中心'
    };

    function switchView(viewId, options) {
      const target = String(viewId || 'home');
      if (!viewTitles[target]) return;
      if (target === 'admin' && !(state.profile && state.profile.isAdmin)) return;

      state.activeView = target;
      elements.appViews.forEach(function (view) {
        view.classList.toggle('active', view.dataset.view === target);
      });
      elements.navButtons.forEach(function (button) {
        const active = button.dataset.viewTarget === target;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
      elements.appTitle.textContent = viewTitles[target];
      elements.appContent.scrollTo({ top: 0, behavior: options && options.instant ? 'auto' : 'smooth' });

      if (target === 'history' && !state.historyLoaded) loadMySessions();
      if (target === 'admin' && !state.adminLoaded) loadAdmin();
      if (tg && tg.HapticFeedback && typeof tg.HapticFeedback.selectionChanged === 'function') {
        tg.HapticFeedback.selectionChanged();
      }
    }

    function formatUptime(seconds) {
      const total = Number(seconds || 0);
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);

      if (days > 0) return days + ' 天 ' + hours + ' 小时';
      if (hours > 0) return hours + ' 小时 ' + minutes + ' 分钟';
      return minutes + ' 分钟';
    }

    function renderBilling(billing) {
      const credits = billing && billing.credits ? billing.credits : {};
      const catalog = billing && billing.catalog ? billing.catalog : {};
      elements.billingSummary.innerHTML = '';
      elements.productList.innerHTML = '';

      creditDefinitions.forEach(function (definition) {
        const credit = credits[definition.id] || {};
        const item = document.createElement('div');
        const title = document.createElement('strong');
        const free = document.createElement('span');
        const paid = document.createElement('span');
        item.className = 'balance-item';
        title.textContent = definition.label + (credit.enabled === false ? '（未启用）' : '');
        free.textContent = credit.unlimited
          ? '今日免费：不限'
          : '今日免费：剩余 ' + Number(credit.freeRemaining || 0) + ' / ' + Number(credit.freeDaily || 0) + '（已用 ' + Number(credit.freeUsed || 0) + '）';
        paid.textContent = '已购余额：' + Number(credit.purchased || 0);
        item.appendChild(title);
        item.appendChild(free);
        item.appendChild(document.createElement('br'));
        item.appendChild(paid);
        elements.billingSummary.appendChild(item);
      });

      const purchasesEnabled = catalog.enabled !== false;
      const products = purchasesEnabled && Array.isArray(catalog.products) ? catalog.products : [];
      products.forEach(function (product) {
        const item = document.createElement('div');
        const title = document.createElement('strong');
        const price = document.createElement('span');
        const grants = document.createElement('p');
        item.className = 'product-item';
        title.textContent = product.title || product.titleEn || product.id;
        price.textContent = Number(product.price || 0) + ' Telegram Stars';
        grants.textContent = creditDefinitions
          .filter(function (definition) { return Number(product.credits && product.credits[definition.id] || 0) > 0; })
          .map(function (definition) { return definition.label + ' ' + Number(product.credits[definition.id]); })
          .join(' · ');
        item.appendChild(title);
        item.appendChild(price);
        item.appendChild(grants);
        elements.productList.appendChild(item);
      });

      if (!products.length) {
        const empty = document.createElement('div');
        empty.className = 'notice';
        empty.textContent = purchasesEnabled
          ? '管理员尚未配置可购买额度包；每日免费额度仍可使用。'
          : '购买暂未开放；每日免费额度和已有余额仍可使用。';
        elements.productList.appendChild(empty);
      }
      elements.purchaseHint.classList.toggle('hidden', !purchasesEnabled || products.length === 0);

      elements.billingBadge.textContent = billing && billing.admin ? '管理员不限额' : '已同步';
      elements.billingBadge.className = 'badge';
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
      elements.newsRegionSelect.disabled = !enabled;
      elements.newsLanguageSelect.disabled = !enabled;
      elements.newsTimeZoneSelect.disabled = !enabled;
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
      updateModelDescription();
    }

    function updateModelDescription() {
      const provider = state.catalog.find(function (item) { return item.id === elements.providerSelect.value; });
      const details = provider && Array.isArray(provider.modelDetails) ? provider.modelDetails : [];
      const selected = details.find(function (item) { return item.id === elements.modelSelect.value; });
      if (!selected) {
        const providerId = String(elements.providerSelect.value || 'auto');
        const discovery = provider && provider.discovery || {};
        const needsSelection = providerId !== 'auto' && details.length > 0;
        if (providerId === 'auto') {
          const routing = state.routing || {};
          elements.modelDescription.textContent = [
            routing.defaultProvider ? '当前首选平台：' + routing.defaultProvider : '',
            routing.defaultModel ? '当前首选模型：' + routing.defaultModel : '尚未选定默认模型',
            routing.fallbackOrder && routing.fallbackOrder.length
              ? '失败时自动切换：' + routing.fallbackOrder.join(' → ')
              : '',
            routing.smartRoutingEnabled ? '智能任务路由：已开启' : '智能任务路由：未开启'
          ].filter(Boolean).join('\n');
          elements.modelDescription.classList.toggle('hidden', !elements.modelDescription.textContent);
          return;
        }
        elements.modelDescription.textContent = needsSelection
          ? '请选择一个模型。标记为“价格未知”的模型不会被系统自动设为默认，以免意外使用收费模型。'
          : discovery.error
            ? '模型列表获取失败：' + String(discovery.error)
            : '';
        elements.modelDescription.classList.toggle('hidden', !elements.modelDescription.textContent);
        return;
      }
      const sourceLabels = { provider: '平台官方资料', catalog: '内置推测（非平台说明）', inferred: '名称推测（非平台说明）' };
      const priceLabels = { free: '免费', paid: '收费', unknown: '价格未知' };
      const capabilities = Array.isArray(selected.capabilities) ? selected.capabilities.join('、') : '';
      elements.modelDescription.textContent = [
        capabilities ? '能力：' + capabilities : '',
        selected.description || '',
        '资料来源：' + (sourceLabels[selected.descriptionSource] || '未知'),
        '价格：' + (priceLabels[selected.pricingTier] || '价格未知'),
        selected.contextWindow ? '上下文：' + Number(selected.contextWindow).toLocaleString() + ' tokens' : ''
      ].filter(Boolean).join('\n');
      elements.modelDescription.classList.remove('hidden');
    }

    function renderSettings(data) {
      state.catalog = data.providers || [];
      state.settings = data.settings || {};
      state.routing = data.routing || {};
      state.profile = data.profile || {};
      state.supportUrl = String(data.support && data.support.url || '');
      elements.supportButton.classList.toggle('hidden', !state.supportUrl);
      elements.syncModelsButton.classList.toggle('hidden', !state.profile.isAdmin);
      renderBilling(data.billing || {});

      const runtime = data.runtime || {};
      elements.messages.textContent = String(runtime.messagesHandled ?? 0);
      elements.aiCalls.textContent = String(runtime.aiCalls ?? 0);

      const providerId = state.settings.providerId || 'auto';
      elements.provider.textContent = providerId === 'auto'
        ? (state.routing.defaultProvider || '自动') + '（自动）'
        : providerId;
      elements.model.textContent = state.settings.modelId || state.routing.defaultModel || '自动路由';
      buildOptions(
        elements.providerSelect,
        state.catalog.map(function (item) {
          return { id: item.id, label: item.label };
        }),
        providerId
      );

      updateModelOptions(state.settings.modelId || '');
      buildOptions(elements.languageSelect, data.languages || [], state.profile.preferredLanguage || 'auto');
      const regionOptions = Array.isArray(data.newsRegions) ? data.newsRegions.slice() : [];
      const languageOptions = Array.isArray(data.newsLanguages) ? data.newsLanguages.slice() : [];
      let detectedLanguage = '';
      let detectedRegion = '';
      try {
        detectedLanguage = String(navigator.language || '').replaceAll('_', '-');
        detectedRegion = new Intl.Locale(detectedLanguage).region || '';
      } catch {}
      if (detectedRegion && !regionOptions.some(function (item) { return item.id === detectedRegion; })) {
        regionOptions.splice(1, 0, { id: detectedRegion, label: '本机语言地区（' + detectedRegion + '）' });
      }
      if (detectedLanguage && !languageOptions.some(function (item) { return item.id === detectedLanguage; })) {
        languageOptions.splice(1, 0, { id: detectedLanguage, label: '本机语言（' + detectedLanguage + '）' });
      }
      buildOptions(elements.newsRegionOptions, regionOptions, '');
      buildOptions(elements.newsLanguageOptions, languageOptions, '');
      elements.newsRegionSelect.value = data.news?.region || '';
      elements.newsLanguageSelect.value = data.news?.language || '';

      const timeZoneOptions = Array.isArray(data.newsTimeZones) ? data.newsTimeZones.slice() : [];
      let detectedTimeZone = '';
      try {
        detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch {}
      if (detectedTimeZone && !timeZoneOptions.some(function (item) { return item.id === detectedTimeZone; })) {
        timeZoneOptions.splice(1, 0, { id: detectedTimeZone, label: '本机时区（' + detectedTimeZone + '）' });
      }
      buildOptions(elements.newsTimeZoneOptions, timeZoneOptions, '');
      elements.newsTimeZoneSelect.value = data.news?.timeZone || '';
      const effectiveNews = data.news?.effective || {};
      elements.newsEffectiveLabel.textContent =
        '当前实际使用：' +
        String(effectiveNews.region || '-') + ' · ' +
        String(effectiveNews.language || '-') + ' · ' +
        String(effectiveNews.timeZone || '-');
      buildOptions(elements.personaSelect, data.personas || [], state.profile.persona || 'default');

      elements.fallbackToggle.checked = state.settings.fallbackEnabled !== false;
      elements.userIdLabel.textContent = state.profile.id ? 'ID ' + state.profile.id : '';
      setSettingsEnabled(true);

      if (elements.providerSelect.value === 'auto') {
        elements.modelSelect.disabled = true;
        elements.fallbackToggle.checked = true;
        elements.fallbackToggle.disabled = true;
      }

      if (state.profile.isAdmin) {
        elements.adminPanel.classList.remove('hidden');
        elements.adminNavButton.classList.remove('hidden');
      } else {
        elements.adminPanel.classList.add('hidden');
        elements.adminNavButton.classList.add('hidden');
        if (state.activeView === 'admin') switchView('home', { instant: true });
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
        elements.statusBadge.textContent = data.ok ? '在线' : '异常';
        elements.statusBadge.className = data.ok ? 'badge' : 'badge error';
        elements.provider.textContent = data.provider || '未配置';
        elements.model.textContent = data.model || '未配置';
        elements.uptime.textContent = formatUptime(data.uptime);
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
            newsRegion: elements.newsRegionSelect.value,
            newsLanguage: elements.newsLanguageSelect.value,
            newsTimeZone: elements.newsTimeZoneSelect.value,
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

    async function syncProviderModels() {
      if (!tg || !tg.initData) return;
      elements.syncModelsButton.disabled = true;
      elements.syncModelsButton.textContent = '正在获取模型…';
      showNotice('正在从 AI Hub 获取模型列表…', '');
      try {
        const response = await fetch('/api/miniapp/models/sync', { method: 'POST', headers: authHeaders() });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '模型同步失败');
        await loadSettings();
        showNotice('模型同步完成：聊天模型 ' + Number(data.chatCount || 0) + ' 个，专用模型 ' + Number(data.specializedCount || 0) + ' 个。现在可以在模型下拉框中手动选择。', 'success');
      } catch (error) {
        showNotice(error.message || '模型同步失败。', 'failure');
      } finally {
        elements.syncModelsButton.disabled = false;
        elements.syncModelsButton.textContent = '🔄 获取 AI Hub 最新模型';
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

    function renderAdminGlobalModels(settings) {
      state.adminGlobalAISettings = settings || {};
      elements.adminGlobalProvider.innerHTML = '';
      state.adminProviders.filter(function (provider) { return provider.configured; }).forEach(function (provider) {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.label || provider.id;
        elements.adminGlobalProvider.appendChild(option);
      });
      elements.adminGlobalProvider.value = settings.providerId || '';
      renderAdminGlobalModelOptions(settings.modelId || '');
      elements.adminGlobalModelSource.textContent = settings.source === 'database'
        ? '当前值保存在 SQLite，服务重启后仍然有效。'
        : '当前沿用 Zeabur 环境变量。';
    }

    function renderAdminGlobalModelOptions(selectedModel) {
      const providerId = elements.adminGlobalProvider.value;
      const provider = state.adminProviders.find(function (item) { return item.id === providerId; });
      const models = provider && Array.isArray(provider.models) ? provider.models : [];
      elements.adminGlobalModel.innerHTML = '';
      models.forEach(function (model) {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        elements.adminGlobalModel.appendChild(option);
      });
      if (selectedModel && models.includes(selectedModel)) elements.adminGlobalModel.value = selectedModel;
      elements.adminGlobalModel.disabled = models.length === 0;
      elements.adminGlobalModelSave.disabled = !providerId || models.length === 0;
    }

    async function saveAdminGlobalModels(reset) {
      const accepted = await askConfirmation(reset
        ? '确定恢复 Zeabur 环境变量中的默认模型吗？'
        : '确定修改所有“自动模式”用户的全局默认模型吗？');
      if (!accepted) return;
      showAdminNotice(reset ? '正在恢复环境变量…' : '正在保存全局默认模型…', '');
      try {
        const response = await fetch('/api/miniapp/admin/global-ai-settings', {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(reset ? { reset: true } : {
            providerId: elements.adminGlobalProvider.value,
            modelId: elements.adminGlobalModel.value
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '保存失败');
        state.adminProviders = data.providers || state.adminProviders;
        renderAdminGlobalModels(data.globalAISettings || {});
        renderProviderStatus(state.adminProviders);
        showAdminNotice(reset ? '已恢复环境变量默认值。' : '全局默认模型已保存。', 'success');
      } catch (error) {
        showAdminNotice(error.message || '全局默认模型保存失败。', 'failure');
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

    function appendAdminUserEditor(container, user) {
      const runtime = user.runtime || {};
      const meta = document.createElement('div');
      meta.className = 'user-meta';
      meta.textContent = [
        'ID ' + user.id,
        user.username ? '@' + user.username : '',
        '今日免费聊天 ' + Number(user.dailyUsageCount || 0) + ' / ' + quotaDisplayValue(user.dailyQuota),
        '个人已处理消息 ' + Number(runtime.messagesHandled ?? user.totalMessages ?? 0),
        '个人 AI 调用 ' + Number(runtime.aiCalls || 0),
        '最近活跃 ' + formatDateTime(user.lastSeenAt)
      ].filter(Boolean).join(' · ');
      container.appendChild(meta);

      const aiScope = document.createElement('div');
      aiScope.className = 'notice';
      aiScope.textContent = [
        '模型：' + (user.usesAutomaticModel ? '自动（继承全局）' : '用户手动选择'),
        (user.effectiveAIProvider || 'auto') + ' / ' + (user.effectiveAIModel || '自动路由'),
        '已记录平台成本：$' + Number(runtime.providerCostUsd || 0).toFixed(4),
        'Agent 任务：' + Number(runtime.agentTasks || 0) + '（运行中 ' + Number(runtime.activeAgentTasks || 0) + '）'
      ].join(' · ');
      container.appendChild(aiScope);

      const actions = document.createElement('div');
      actions.className = 'user-actions';
      const blockButton = document.createElement('button');
      blockButton.type = 'button';
      blockButton.className = user.isBlocked ? 'success-button compact-button' : 'danger-button compact-button';
      blockButton.textContent = user.isBlocked ? '解除封禁' : '封禁用户';
      blockButton.dataset.userId = String(user.id);
      blockButton.dataset.blocked = user.isBlocked ? 'true' : 'false';
      blockButton.dataset.userAction = 'toggle-block';
      const isSelf = state.profile && String(state.profile.id) === String(user.id);
      blockButton.disabled = Boolean(user.isAdmin || isSelf);
      if (isSelf) blockButton.textContent = '当前账号';
      if (user.isAdmin && !isSelf) blockButton.textContent = '管理员账号';
      actions.appendChild(blockButton);
      container.appendChild(actions);

      const quotaEditor = document.createElement('div');
      quotaEditor.className = 'quota-editor';
      const quotaField = document.createElement('label');
      quotaField.className = 'quota-field';
      quotaField.textContent = '个人每日免费聊天额度（0 表示不限）';
      const quotaInput = document.createElement('input');
      quotaInput.type = 'number';
      quotaInput.min = '0';
      quotaInput.max = '1000000';
      quotaInput.step = '1';
      quotaInput.inputMode = 'numeric';
      quotaInput.dataset.userQuotaInput = String(user.id);
      quotaInput.value = user.usesGlobalQuota ? '' : String(Number(user.dailyQuotaOverride || 0));
      quotaInput.placeholder = '默认免费聊天：' + quotaDisplayValue(user.dailyQuota);
      quotaField.appendChild(quotaInput);
      const saveQuota = document.createElement('button');
      saveQuota.type = 'button';
      saveQuota.className = 'primary compact-button';
      saveQuota.textContent = '保存';
      saveQuota.dataset.userId = String(user.id);
      saveQuota.dataset.userAction = 'save-quota';
      const resetQuota = document.createElement('button');
      resetQuota.type = 'button';
      resetQuota.className = 'secondary compact-button';
      resetQuota.textContent = '恢复默认';
      resetQuota.dataset.userId = String(user.id);
      resetQuota.dataset.userAction = 'reset-quota';
      resetQuota.disabled = Boolean(user.usesGlobalQuota);
      quotaEditor.appendChild(quotaField);
      quotaEditor.appendChild(saveQuota);
      quotaEditor.appendChild(resetQuota);
      container.appendChild(quotaEditor);

      const creditEditor = document.createElement('div');
      creditEditor.className = 'credit-editor';
      const creditHead = document.createElement('div');
      creditHead.className = 'credit-editor-head';
      creditHead.innerHTML = '<span class="credit-editor-title">已购额度余额</span><span class="credit-editor-note">不影响每日免费额度</span>';
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
      container.appendChild(creditEditor);
    }

    function showAdminUser(user) {
      if (!user) return false;
      state.adminSelectedUserId = String(user.id);
      elements.adminUserSheetTitle.textContent = userDisplayName(user);
      elements.adminUserSheetBody.innerHTML = '';
      appendAdminUserEditor(elements.adminUserSheetBody, user);
      elements.adminUserSheet.classList.remove('hidden');
      return true;
    }

    function openAdminUser(userId) {
      const user = state.adminUsers.find(function (item) { return String(item.id) === String(userId); });
      return showAdminUser(user);
    }

    async function openAdminUserById(userId) {
      if (openAdminUser(userId)) return;
      state.adminSelectedUserId = String(userId);
      elements.adminUserSheetTitle.textContent = '正在读取用户…';
      elements.adminUserSheetBody.innerHTML = '';
      elements.adminUserSheet.classList.remove('hidden');
      try {
        const response = await fetch('/api/miniapp/admin/users/' + encodeURIComponent(userId), {
          method: 'GET', cache: 'no-store', headers: authHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '读取用户失败');
        if (state.adminSelectedUserId === String(userId)) showAdminUser(data.user);
      } catch (error) {
        if (state.adminSelectedUserId === String(userId)) closeAdminUser();
        showAdminNotice(error.message || '读取用户失败。', 'failure');
      }
    }

    function closeAdminUser() {
      state.adminSelectedUserId = '';
      elements.adminUserSheet.classList.add('hidden');
      elements.adminUserSheetBody.innerHTML = '';
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
        name.className = 'user-name';
        name.textContent = userDisplayName(user);
        const meta = document.createElement('div');
        meta.className = 'user-meta';
        meta.textContent = [
          'ID ' + user.id,
          '今日 ' + Number(user.dailyUsageCount || 0),
          '消息 ' + Number(user.runtime?.messagesHandled ?? user.totalMessages ?? 0),
          'AI ' + Number(user.runtime?.aiCalls || 0),
          formatDateTime(user.lastSeenAt)
        ].join(' · ');
        const pill = document.createElement('span');
        pill.className = user.isBlocked ? 'status-pill blocked' : user.isAdmin ? 'status-pill' : 'status-pill muted';
        pill.textContent = user.isBlocked ? '已封禁' : user.isAdmin ? '管理员' : '正常';
        copy.appendChild(name);
        copy.appendChild(meta);
        head.appendChild(copy);
        head.appendChild(pill);
        const actions = document.createElement('div');
        actions.className = 'user-actions';
        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'secondary compact-button';
        openButton.textContent = '管理';
        openButton.dataset.userId = String(user.id);
        openButton.dataset.userAction = 'open';
        actions.appendChild(openButton);
        item.appendChild(head);
        item.appendChild(actions);
        elements.adminUserList.appendChild(item);
      });
      if (!elements.adminUserList.children.length) {
        const empty = document.createElement('div');
        empty.className = 'notice';
        empty.textContent = '没有找到用户。';
        elements.adminUserList.appendChild(empty);
      }
    }

    async function fetchAdminUsers(options) {
      const opts = options || {};
      if (opts.resetPage) state.adminUserPage = 0;
      const requestId = ++state.adminUserRequestId;
      elements.adminSearchButton.disabled = true;
      elements.adminUserList.setAttribute('aria-busy', 'true');
      const params = new URLSearchParams({
        limit: String(state.adminUserPageSize),
        offset: String(state.adminUserPage * state.adminUserPageSize),
        status: elements.adminUserStatus.value,
        sort: elements.adminUserSort.value
      });
      const query = elements.adminUserSearch.value.trim();
      if (query) params.set('q', query);
      try {
        const response = await fetch('/api/miniapp/admin/users?' + params.toString(), {
          method: 'GET', cache: 'no-store', headers: authHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '读取用户失败');
        if (requestId !== state.adminUserRequestId) return;
        state.adminUserTotal = Number(data.total || 0);
        renderAdminUsers(data.items || []);
        const pageCount = Math.max(1, Math.ceil(state.adminUserTotal / state.adminUserPageSize));
        elements.adminUserResult.textContent = '找到 ' + state.adminUserTotal + ' 人';
        elements.adminUserPage.textContent = '第 ' + (state.adminUserPage + 1) + ' / ' + pageCount + ' 页';
        elements.adminUserPrev.disabled = state.adminUserPage <= 0;
        elements.adminUserNext.disabled = state.adminUserPage + 1 >= pageCount;
        if (state.adminSelectedUserId) {
          openAdminUser(state.adminSelectedUserId);
        }
      } finally {
        if (requestId === state.adminUserRequestId) {
          elements.adminSearchButton.disabled = false;
          elements.adminUserList.removeAttribute('aria-busy');
        }
      }
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
        state.adminProviders = data.providers || [];
        renderProviderStatus(state.adminProviders);
        renderAdminGlobalModels(data.globalAISettings || {});
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

        await fetchAdminUsers();
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
          elements.adminUserSheetBody.querySelectorAll('input[data-user-quota-input]')
        ).find(function (candidate) {
          return candidate.dataset.userQuotaInput === String(userId);
        });
        const rawValue = input ? input.value.trim() : '';
        dailyQuota = Number(rawValue);

        if (!rawValue || !Number.isInteger(dailyQuota) || dailyQuota < 0 || dailyQuota > 1000000) {
          showAdminNotice('个人每日免费聊天额度必须是 0 到 1000000 之间的整数。', 'failure');
          return;
        }
      }

      showAdminNotice(
        resetToGlobal ? '正在恢复默认每日免费聊天额度…' : '正在保存个人每日免费聊天额度…',
        ''
      );

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

        await fetchAdminUsers();
        showAdminNotice(
          resetToGlobal ? '已恢复默认每日免费聊天额度。' : '个人每日免费聊天额度已保存。',
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
        elements.adminUserSheetBody.querySelectorAll('input[data-user-credit-input]')
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

        await fetchAdminUsers();
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
        const userButton = document.createElement('button');

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

        userButton.type = 'button';
        userButton.className = 'secondary compact-button';
        userButton.textContent = '管理用户';
        userButton.dataset.adminUserId = session.userId;

        actions.appendChild(userButton);
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

    async function fetchAdminSessions(options) {
      const opts = options || {};
      if (opts.resetPage) state.adminSessionPage = 0;
      const requestId = ++state.adminSessionRequestId;
      elements.adminSessionSearchButton.disabled = true;
      elements.adminSessionList.setAttribute('aria-busy', 'true');
      const params = new URLSearchParams({
        limit: String(state.adminSessionPageSize),
        offset: String(state.adminSessionPage * state.adminSessionPageSize),
        status: elements.adminSessionStatus.value,
        sort: elements.adminSessionSort.value
      });
      const query = elements.adminSessionSearch.value.trim();
      if (query) params.set('q', query);

      try {
        const response = await fetch('/api/miniapp/admin/sessions?' + params.toString(), {
          method: 'GET',
          cache: 'no-store',
          headers: authHeaders()
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || '读取会话概况失败');
        if (requestId !== state.adminSessionRequestId) return;
        state.adminSessionTotal = Number(data.total || 0);
        renderAdminSessions(data.items || []);
        const pageCount = Math.max(1, Math.ceil(state.adminSessionTotal / state.adminSessionPageSize));
        elements.adminSessionResult.textContent = '找到 ' + state.adminSessionTotal + ' 个会话';
        elements.adminSessionPage.textContent = '第 ' + (state.adminSessionPage + 1) + ' / ' + pageCount + ' 页';
        elements.adminSessionPrev.disabled = state.adminSessionPage <= 0;
        elements.adminSessionNext.disabled = state.adminSessionPage + 1 >= pageCount;
      } finally {
        if (requestId === state.adminSessionRequestId) {
          elements.adminSessionSearchButton.disabled = false;
          elements.adminSessionList.removeAttribute('aria-busy');
        }
      }
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
        elements.adminSessionSheet.classList.remove('hidden');
        hideAdminNotice();
      } catch (error) {
        showAdminNotice(error.message || '读取会话摘要失败。', 'failure');
      }
    }

    function setupTelegram() {
      if (!tg || !tg.initData) {
        elements.welcome.textContent = '当前在普通浏览器中打开，可查看状态；个人设置需要从 Telegram 打开。';
        return;
      }

      tg.ready();
      tg.expand();
      if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
      if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('secondary_bg_color');
      if (typeof tg.setBottomBarColor === 'function') tg.setBottomBarColor('secondary_bg_color');

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
      if (elements.providerSelect.value === 'auto') {
        elements.fallbackToggle.checked = true;
        elements.fallbackToggle.disabled = true;
      } else {
        elements.fallbackToggle.disabled = false;
      }
    });
    elements.viewButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        switchView(button.dataset.viewTarget);
      });
    });
    elements.modelSelect.addEventListener('change', updateModelDescription);
    elements.syncModelsButton.addEventListener('click', syncProviderModels);

    elements.settingsForm.addEventListener('submit', saveSettings);

    elements.refreshButton.addEventListener('click', function () {
      loadStatus();
      loadSettings();
      if (state.activeView === 'history') loadMySessions();
      if (state.activeView === 'admin' && state.profile && state.profile.isAdmin) {
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

    elements.adminTabs.forEach(function (button) {
      button.addEventListener('click', function () {
        const target = button.dataset.adminPaneTarget;
        elements.adminTabs.forEach(function (tab) { tab.classList.toggle('active', tab === button); });
        elements.adminPanes.forEach(function (pane) { pane.classList.toggle('active', pane.dataset.adminPane === target); });
        if (target === 'users' && !state.adminUsersLoaded) {
          fetchAdminUsers({ resetPage: true }).then(function () {
            state.adminUsersLoaded = true;
          }).catch(function (error) { showAdminNotice(error.message || '读取用户失败。', 'failure'); });
        }
        if (target === 'sessions' && !state.adminSessionsLoaded) {
          fetchAdminSessions({ resetPage: true }).then(function () {
            state.adminSessionsLoaded = true;
          }).catch(function (error) { showAdminNotice(error.message || '读取会话失败。', 'failure'); });
        }
      });
    });

    elements.adminGlobalProvider.addEventListener('change', function () {
      renderAdminGlobalModelOptions('');
    });
    elements.adminGlobalModelSave.addEventListener('click', function () {
      saveAdminGlobalModels(false);
    });
    elements.adminGlobalModelReset.addEventListener('click', function () {
      saveAdminGlobalModels(true);
    });

    elements.adminSearchButton.addEventListener('click', function () {
      fetchAdminUsers({ resetPage: true }).catch(function (error) {
        showAdminNotice(error.message || '搜索失败。', 'failure');
      });
    });

    elements.adminUserSearch.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        elements.adminSearchButton.click();
      }
    });
    elements.adminUserSearch.addEventListener('input', function () {
      clearTimeout(adminUserSearchTimer);
      adminUserSearchTimer = setTimeout(function () {
        fetchAdminUsers({ resetPage: true }).catch(function (error) {
          showAdminNotice(error.message || '搜索失败。', 'failure');
        });
      }, 350);
    });

    elements.adminUserList.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-user-id]');
      if (!button || button.disabled) return;
      const action = button.dataset.userAction;
      if (action === 'open') openAdminUserById(button.dataset.userId);
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

    elements.adminUserSheetBody.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-user-id]');
      if (!button || button.disabled) return;
      const action = button.dataset.userAction;
      if (action === 'toggle-block') updateUserBlock(button.dataset.userId, button.dataset.blocked === 'true');
      if (action === 'save-quota') updateUserQuota(button.dataset.userId, false);
      if (action === 'reset-quota') updateUserQuota(button.dataset.userId, true);
      if (action === 'save-credits') updateUserCredits(button.dataset.userId);
    });

    elements.adminUserSheetClose.addEventListener('click', closeAdminUser);
    elements.adminUserSheet.addEventListener('click', function (event) {
      if (event.target === elements.adminUserSheet) closeAdminUser();
    });

    elements.adminUserStatus.addEventListener('change', function () { elements.adminSearchButton.click(); });
    elements.adminUserSort.addEventListener('change', function () { elements.adminSearchButton.click(); });
    elements.adminUserPageSize.addEventListener('change', function () {
      state.adminUserPageSize = Number(elements.adminUserPageSize.value) || 20;
      fetchAdminUsers({ resetPage: true }).catch(function (error) {
        showAdminNotice(error.message || '读取用户失败。', 'failure');
      });
    });
    elements.adminUserPrev.addEventListener('click', function () {
      if (state.adminUserPage <= 0) return;
      state.adminUserPage -= 1;
      fetchAdminUsers().catch(function (error) { showAdminNotice(error.message || '翻页失败。', 'failure'); });
    });
    elements.adminUserNext.addEventListener('click', function () {
      state.adminUserPage += 1;
      fetchAdminUsers().catch(function (error) { showAdminNotice(error.message || '翻页失败。', 'failure'); });
    });

    elements.adminSessionSearchButton.addEventListener('click', function () {
      fetchAdminSessions({ resetPage: true }).catch(function (error) {
        showAdminNotice(error.message || '筛选会话失败。', 'failure');
      });
    });

    elements.adminSessionSearch.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        elements.adminSessionSearchButton.click();
      }
    });
    elements.adminSessionSearch.addEventListener('input', function () {
      clearTimeout(adminSessionSearchTimer);
      adminSessionSearchTimer = setTimeout(function () {
        fetchAdminSessions({ resetPage: true }).catch(function (error) {
          showAdminNotice(error.message || '筛选会话失败。', 'failure');
        });
      }, 350);
    });

    elements.adminSessionStatus.addEventListener('change', function () { elements.adminSessionSearchButton.click(); });
    elements.adminSessionSort.addEventListener('change', function () { elements.adminSessionSearchButton.click(); });
    elements.adminSessionPageSize.addEventListener('change', function () {
      state.adminSessionPageSize = Number(elements.adminSessionPageSize.value) || 20;
      fetchAdminSessions({ resetPage: true }).catch(function (error) {
        showAdminNotice(error.message || '读取会话失败。', 'failure');
      });
    });
    elements.adminSessionPrev.addEventListener('click', function () {
      if (state.adminSessionPage <= 0) return;
      state.adminSessionPage -= 1;
      fetchAdminSessions().catch(function (error) { showAdminNotice(error.message || '翻页失败。', 'failure'); });
    });
    elements.adminSessionNext.addEventListener('click', function () {
      state.adminSessionPage += 1;
      fetchAdminSessions().catch(function (error) { showAdminNotice(error.message || '翻页失败。', 'failure'); });
    });

    elements.adminSessionList.addEventListener('click', function (event) {
      const userButton = event.target.closest('button[data-admin-user-id]');
      if (userButton) {
        openAdminUserById(userButton.dataset.adminUserId);
        return;
      }
      const button = event.target.closest('button[data-admin-session-id]');
      if (!button) return;
      viewAdminSession(button.dataset.adminSessionId);
    });

    elements.adminSessionViewerClose.addEventListener('click', function () {
      elements.adminSessionSheet.classList.add('hidden');
    });
    elements.adminSessionSheet.addEventListener('click', function (event) {
      if (event.target === elements.adminSessionSheet) elements.adminSessionSheet.classList.add('hidden');
    });

    elements.closeButton.addEventListener('click', function () {
      if (tg) {
        tg.close();
      } else {
        window.history.back();
      }
    });

    elements.supportButton.addEventListener('click', function () {
      if (!state.supportUrl) return;
      if (tg && state.supportUrl.startsWith('https://t.me/') && typeof tg.openTelegramLink === 'function') {
        tg.openTelegramLink(state.supportUrl);
        return;
      }
      if (tg && typeof tg.openLink === 'function') {
        tg.openLink(state.supportUrl);
        return;
      }
      window.open(state.supportUrl, '_blank', 'noopener,noreferrer');
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
  const build = getBuildInfo();

  return {
    ok: true,
    status: 'ok',
    service: 'telegram-ai-bot-pro',
    timestamp: new Date().toISOString(),
    version: build.version,
    revision: build.revision,
    shortRevision: build.shortRevision,
    node: build.nodeVersion,
    environment: build.environment,
    deployedAt: build.deployedAt,
    startedAt: build.startedAt,
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
    'gemini-live': config.geminiLiveApiKey,
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

function buildProviderCatalog(config, providerManager = null) {
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
    .map((providerId) => {
      const dynamicModels = providerId === 'auto' ? [] : providerManager?.getProviderModels?.(providerId) || [];
      const modelDetails = providerId === 'auto' ? [] : providerManager?.getModelCatalog?.(providerId) || [];
      return {
        id: providerId,
        label: PROVIDER_LABELS[providerId] || providerId,
        models: providerId === 'auto'
          ? []
          : Array.from(new Set([
              ...dynamicModels,
              ...(config.providerModels?.[providerId] || []),
              providerId === currentProvider ? config.defaultModel : ''
            ].map((item) => String(item || '').trim()).filter(Boolean))),
        modelDetails: modelDetails.map((item) => ({
          id: item.id,
          description: item.description,
          descriptionSource: item.descriptionSource,
          pricingTier: item.pricingTier,
          pricingSource: item.pricingSource,
          capabilities: item.capabilities,
          contextWindow: item.contextWindow,
          endpointType: item.endpointType,
          chatCompatible: item.chatCompatible
        })),
        discovery: providerManager?.getModelDiscoveryStatus?.(providerId) || null
      };
    });
}

function resolveGlobalAISettings(db, config, providerManager = null) {
  const stored = db?.getGlobalAISettings?.() || {};
  const providerId = String(
    stored.providerId || config.defaultAIProvider || config.aiProvider || 'auto'
  ).trim();
  const models = providerId === 'auto'
    ? []
    : providerManager?.getProviderModels?.(providerId) || config.providerModels?.[providerId] || [];
  const storedModel = String(stored.modelId || '').trim();
  const configuredModel = providerId === String(config.aiProvider || '')
    ? String(config.defaultModel || '').trim()
    : '';
  const modelId = storedModel && (models.length === 0 || models.includes(storedModel))
    ? storedModel
    : models[0] || configuredModel;
  return {
    providerId,
    modelId,
    source: stored.providerId || stored.modelId ? 'database' : 'environment',
    updatedAt: stored.updatedAt || ''
  };
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

function withInheritedNewsOption(options, currentValue, effectiveValue, inheritedLabel) {
  const items = [
    {
      id: '',
      label: `${inheritedLabel}（当前：${effectiveValue || '-'}）`
    },
    ...options
  ];
  if (currentValue && !items.some((item) => item.id === currentValue)) {
    items.push({ id: currentValue, label: `${currentValue}（当前设置）` });
  }
  if (effectiveValue && !items.some((item) => item.id === effectiveValue)) {
    items.push({ id: effectiveValue, label: `${effectiveValue}（当前自动值）` });
  }
  return items;
}

function serializeSettingsResponse({ db, config, providerManager = null, userId, telegramLanguageCode = '' }) {
  const user = db.findUser(userId);
  const settings = db.getUserAISettings(userId);
  const globalAISettings = resolveGlobalAISettings(db, config, providerManager);
  const news = db.getUserNewsSettings?.(userId) || {
    region: '',
    language: '',
    timeZone: '',
    updatedAt: ''
  };
  const effectiveNews = resolveEffectiveNewsSettings({
    stored: news,
    config,
    locale: user?.preferredLanguage || telegramLanguageCode,
    telegramLanguageCode
  });
  const billing = buildUserBillingSnapshot({
    db,
    config,
    userId,
    isAdmin: Boolean(user?.isAdmin)
  });
  const supportUrl = resolveSupportContactUrl(config);

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
    routing: {
      defaultProvider: globalAISettings.providerId,
      defaultModel: globalAISettings.modelId,
      fallbackOrder: Array.isArray(config.aiProviderFallbackOrder) ? config.aiProviderFallbackOrder : [],
      smartRoutingEnabled: config.smartRoutingEnabled === true,
      modelSelectionRequired: config.modelSelectionRequired === true
    },
    news: {
      region: news.region || '',
      language: news.language || '',
      timeZone: news.timeZone || '',
      updatedAt: news.updatedAt || '',
      effective: {
        region: effectiveNews.region,
        language: effectiveNews.language,
        timeZone: effectiveNews.timeZone
      }
    },
    billing,
    runtime: typeof db.getUserRuntimeSummary === 'function'
      ? db.getUserRuntimeSummary(userId)
      : { messagesHandled: Number(user?.totalMessages || 0), aiCalls: Number(user?.aiCalls || 0) },
    support: {
      enabled: Boolean(supportUrl),
      url: supportUrl
    },
    providers: buildProviderCatalog(config, providerManager),
    languages: LANGUAGE_OPTIONS,
    personas: PERSONA_OPTIONS,
    newsRegions: withInheritedNewsOption(
      NEWS_REGION_OPTIONS,
      news.region,
      effectiveNews.region,
      '自动判断'
    ),
    newsLanguages: withInheritedNewsOption(
      NEWS_LANGUAGE_OPTIONS,
      news.language,
      effectiveNews.language,
      '跟随回复语言'
    ),
    newsTimeZones: withInheritedNewsOption(
      NEWS_TIME_ZONE_OPTIONS,
      news.timeZone,
      effectiveNews.timeZone,
      '自动判断'
    )
  };
}

function validateSettingsPayload(payload, config, providerManager = null) {
  const catalog = buildProviderCatalog(config, providerManager);
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

  const newsPatch = {};
  if (Object.hasOwn(payload, 'newsRegion')) {
    if (!isValidNewsRegion(payload.newsRegion)) {
      throw new Error('NEWS_REGION_INVALID');
    }
    newsPatch.region = normalizeNewsRegion(payload.newsRegion);
  }
  if (Object.hasOwn(payload, 'newsLanguage')) {
    if (!isValidNewsLanguage(payload.newsLanguage)) {
      throw new Error('NEWS_LANGUAGE_INVALID');
    }
    newsPatch.language = normalizeNewsLanguage(payload.newsLanguage);
  }
  if (Object.hasOwn(payload, 'newsTimeZone')) {
    if (!isValidNewsTimeZone(payload.newsTimeZone)) {
      throw new Error('NEWS_TIME_ZONE_INVALID');
    }
    newsPatch.timeZone = normalizeNewsTimeZone(payload.newsTimeZone);
  }

  return {
    providerId,
    modelId,
    fallbackEnabled: providerId === 'auto' ? true : payload.fallbackEnabled !== false,
    preferredLanguage,
    persona,
    newsPatch
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

function buildAdminProviderStatus(config, providerManager = null, globalAISettings = null) {
  return PROVIDER_ORDER
    .filter((providerId) => providerId !== 'auto')
    .map((providerId) => ({
      id: providerId,
      label: PROVIDER_LABELS[providerId] || providerId,
      configured: hasProviderCredential(config, providerId),
      current: String(globalAISettings?.providerId || config.aiProvider || '') === providerId,
      models: Array.from(new Set([
        ...(providerManager?.getProviderModels?.(providerId) || []),
        ...(config.providerModels?.[providerId] || []),
        providerId === String(config.aiProvider || '') ? config.defaultModel : ''
      ].map((item) => String(item || '').trim()).filter(Boolean))),
      modelCount: Array.from(new Set([
        ...(providerManager?.getProviderModels?.(providerId) || []),
        ...(config.providerModels?.[providerId] || []),
        providerId === String(config.aiProvider || '') ? config.defaultModel : ''
      ].map((item) => String(item || '').trim()).filter(Boolean))).length
    }));
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

function serializeSessionMessages(
  db,
  sessionId,
  limit = 100,
  maxContentChars = 8000,
  includeUserMessages = false
) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const entries = db.getConversationEntries(sessionId, {
    limit: safeLimit,
    order: 'desc'
  });

  return entries
    .reverse()
    .filter((entry) => includeUserMessages || String(entry.role || '').toLowerCase() === 'assistant')
    .map((entry) => {
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
          url.searchParams.get('limit') || 100,
          8000,
          context.config.miniAppShowUserMessages === true
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
    const billingCatalog = buildBillingCatalog(context.config);
    const globalAISettings = resolveGlobalAISettings(context.db, context.config, context.providerManager);
    sendJson(res, 200, {
      ok: true,
      totalUsers: context.db.countUsers(),
      dailyQuota: Number(billingCatalog.freeQuota.chat || 0),
      billingCatalog,
      stats: context.db.getStats(),
      currentProvider: globalAISettings.providerId,
      currentModel: globalAISettings.modelId,
      globalAISettings,
      providers: buildAdminProviderStatus(context.config, context.providerManager, globalAISettings)
    });
    return;
  }

  if (pathname === '/api/miniapp/admin/global-ai-settings' && req.method === 'PUT') {
    try {
      const payload = await readJsonBody(req);
      if (payload.reset === true) {
        context.db.resetGlobalAISettings();
      } else {
        const providerId = String(payload.providerId || '').trim();
        const modelId = String(payload.modelId || '').trim();
        const providers = buildAdminProviderStatus(context.config, context.providerManager);
        const provider = providers.find((item) => item.id === providerId && item.configured);
        if (!provider) throw new Error('GLOBAL_AI_PROVIDER_INVALID');
        if (!modelId || !provider.models.includes(modelId)) throw new Error('GLOBAL_AI_MODEL_INVALID');
        context.db.setGlobalAISettings({ providerId, modelId });
      }
      const globalAISettings = resolveGlobalAISettings(context.db, context.config, context.providerManager);
      logMiniAppAdminAction(context, {
        actorId: auth.telegramUser.id,
        action: payload.reset === true ? 'global_ai_settings.reset' : 'global_ai_settings.update',
        targetId: 'global',
        details: globalAISettings,
        req
      });
      sendJson(res, 200, {
        ok: true,
        globalAISettings,
        providers: buildAdminProviderStatus(context.config, context.providerManager, globalAISettings)
      });
    } catch (error) {
      const code = String(error?.message || 'GLOBAL_AI_SETTINGS_UPDATE_FAILED');
      sendJson(res, 400, {
        ok: false,
        error: code,
        message: code === 'GLOBAL_AI_PROVIDER_INVALID'
          ? '这个 AI 平台未配置或不可用。'
          : code === 'GLOBAL_AI_MODEL_INVALID'
            ? '这个模型不在当前平台的可用列表中。'
            : '全局默认模型保存失败。'
      });
    }
    return;
  }

  if (pathname === '/api/miniapp/admin/users' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim();
    const status = ['active', 'blocked', 'admin'].includes(url.searchParams.get('status'))
      ? url.searchParams.get('status')
      : 'all';
    const sort = ['recent', 'oldest', 'usage', 'name'].includes(url.searchParams.get('sort'))
      ? url.searchParams.get('sort')
      : 'recent';
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const items = context.db
      .listUsers({ q, status, sort, limit, offset })
      .map((user) => serializeAdminUser(context.db, user, context.config));

    sendJson(res, 200, {
      ok: true,
      items,
      total: context.db.countUsers({ q, status }),
      limit,
      offset
    });
    return;
  }

  if (pathname === '/api/miniapp/admin/sessions' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim();
    const userId = String(url.searchParams.get('userId') || '').trim();
    const chatId = String(url.searchParams.get('chatId') || '').trim();
    const status = ['active', 'archived'].includes(url.searchParams.get('status'))
      ? url.searchParams.get('status')
      : '';
    const sort = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'recent';
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const sessions = context.db.listAdminSessions({
      q,
      userId,
      chatId,
      status,
      sort,
      limit,
      offset
    });

    sendJson(res, 200, {
      ok: true,
      items: sessions.map((session) =>
        serializeSession(session, context.db.findUser(session.userId) || null)
      ),
      total: typeof context.db.countAdminSessions === 'function'
        ? context.db.countAdminSessions({ q, userId, chatId, status })
        : sessions.length,
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
        800,
        context.config.miniAppShowUserMessages === true
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
          user: serializeAdminUser(context.db, context.db.findUser(targetUserId), context.config)
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
  if (userMatch && req.method === 'GET') {
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
    sendJson(res, 200, {
      ok: true,
      user: serializeAdminUser(context.db, targetUser, context.config)
    });
    return;
  }
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

        const defaultChatQuota = getDefaultChatFreeQuota(context.config);
        if (payload.dailyQuota === null) {
          await context.db.clearUserDailyQuota(targetUserId, defaultChatQuota);
        } else {
          await context.db.setUserDailyQuota(
            targetUserId,
            payload.dailyQuota,
            defaultChatQuota
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
        user: serializeAdminUser(context.db, updated, context.config)
      });
    } catch (error) {
      const code = String(error?.message || 'ADMIN_USER_UPDATE_FAILED');
      sendJson(res, 400, {
        ok: false,
        error: code,
        message: code === 'INVALID_DAILY_QUOTA'
          ? '个人每日免费聊天额度必须是 0 到 1000000 之间的整数，null 表示恢复默认值。'
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
        providerManager: context.providerManager,
        userId: auth.telegramUser.id,
        telegramLanguageCode: auth.telegramUser.language_code
      })
    );
    return;
  }

  if (req.method === 'PUT') {
    try {
      const payload = await readJsonBody(req);
      const next = validateSettingsPayload(payload, context.config, context.providerManager);

      context.db.setUserAISettings(auth.telegramUser.id, {
        providerId: next.providerId === 'auto' ? '' : next.providerId,
        modelId: next.modelId,
        fallbackEnabled: next.fallbackEnabled
      });

      await context.db.setUserSettings(auth.telegramUser.id, {
        preferredLanguage: next.preferredLanguage,
        persona: next.persona
      });
      if (Object.keys(next.newsPatch).length > 0) {
        context.db.setUserNewsSettings(auth.telegramUser.id, next.newsPatch);
      }

      sendJson(
        res,
        200,
        serializeSettingsResponse({
          db: context.db,
          config: context.config,
          providerManager: context.providerManager,
          userId: auth.telegramUser.id,
          telegramLanguageCode: auth.telegramUser.language_code
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

async function handleMiniAppModelSync(req, res, context) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  try {
    const auth = await getAuthenticatedUser(req, context);
    if (!isAdminUser(context.config, auth.telegramUser.id)) {
      sendJson(res, 403, { ok: false, error: 'ADMIN_REQUIRED', message: '仅管理员可以同步平台模型。' });
      return;
    }
    if (!context.providerManager?.refreshModels) throw new Error('MODEL_DISCOVERY_UNAVAILABLE');
    const result = await context.providerManager.refreshModels('openai-compatible', { force: true });
    sendJson(res, 200, {
      ok: true,
      count: result.count,
      chatCount: result.chatCount,
      specializedCount: Math.max(0, result.count - result.chatCount),
      updatedAt: result.updatedAt
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse.statusCode !== 401) {
      sendJson(res, 502, { ok: false, error: 'MODEL_SYNC_FAILED', message: String(error.message || '模型同步失败。') });
      return;
    }
    sendJson(res, authResponse.statusCode, authResponse.payload);
  }
}

export function startHealthServer({ port, db, config, logger, providerManager = null, githubService = null, readiness = null }) {
  const effectiveReadiness = readiness || { ready: true, phase: 'ready' };
  const context = { db, config, logger, providerManager, githubService, readiness: effectiveReadiness };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === config.githubAppCallbackPath) {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        try {
          const code = url.searchParams.get('code') || '';
          const state = url.searchParams.get('state') || '';
          if (!code || !state) throw new Error('GitHub did not return an authorization code.');
          const connection = await githubService?.completeAuthorization({ code, state });
          if (!connection) throw new Error('GitHub authorization is not configured.');
          sendHtml(res, 200, '<!doctype html><meta charset="utf-8"><title>GitHub connected</title><main style="font-family:system-ui;max-width:560px;margin:64px auto;padding:24px"><h1>GitHub 已连接</h1><p>可以关闭此页面并返回 Telegram。</p></main>');
        } catch (error) {
          logger.warn('GitHub OAuth callback failed', { error: error.message });
          sendHtml(res, 400, '<!doctype html><meta charset="utf-8"><title>GitHub connection failed</title><main style="font-family:system-ui;max-width:560px;margin:64px auto;padding:24px"><h1>GitHub 连接失败</h1><p>授权已过期或配置不完整，请返回 Telegram 重试。</p></main>');
        }
        return;
      }

      if (pathname === '/app' || pathname === '/app/') {
        sendHtml(res, 200, MINI_APP_HTML);
        return;
      }

      if (pathname === '/api/miniapp/settings') {
        await handleMiniAppApi(req, res, context);
        return;
      }

      if (pathname === '/api/miniapp/models/sync') {
        await handleMiniAppModelSync(req, res, context);
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
        if (config.healthCheckEnabled === false) {
          sendJson(res, 404, {
            ok: false,
            status: 'disabled',
            error: 'HEALTH_CHECK_DISABLED'
          });
          return;
        }

        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          sendJson(res, 405, {
            ok: false,
            error: 'METHOD_NOT_ALLOWED'
          });
          return;
        }

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
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          sendJson(res, 405, {
            ok: false,
            error: 'METHOD_NOT_ALLOWED'
          });
          return;
        }

        try {
          db.getStats();
          if (!effectiveReadiness.ready) {
            sendJson(res, 503, {
              ok: false,
              ready: false,
              phase: effectiveReadiness.phase || 'initializing',
              error: 'NOT_READY'
            });
            return;
          }
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
          ...(config.healthCheckEnabled === false ? [] : ['/']),
          '/app',
          '/api/miniapp/settings',
          '/api/miniapp/sessions',
          '/api/miniapp/sessions/:id',
          '/api/miniapp/admin/overview',
          '/api/miniapp/admin/users',
          '/api/miniapp/admin/users/:id/credits',
          '/api/miniapp/admin/sessions',
          ...(config.healthCheckEnabled === false ? [] : ['/health']),
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
        ...(config.healthCheckEnabled === false ? [] : ['/']),
        '/app',
        '/api/miniapp/settings',
        '/api/miniapp/sessions',
        '/api/miniapp/sessions/:id',
        '/api/miniapp/admin/overview',
        '/api/miniapp/admin/users',
        '/api/miniapp/admin/users/:id/credits',
        '/api/miniapp/admin/sessions',
        ...(config.healthCheckEnabled === false ? [] : ['/health']),
        '/ready'
      ]
    });
  });

  return server;
}
