import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

function mask(value = '') {
  const raw = String(value || '');
  if (!raw) return 'missing';
  if (raw.length <= 8) return 'set';
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function ok(message) {
  console.log(`✅ ${message}`);
}

function warn(message) {
  console.log(`⚠️  ${message}`);
}

function fail(message) {
  console.log(`❌ ${message}`);
}

function hasEnv(...names) {
  return names.some((name) => Boolean(String(process.env[name] || '').trim()));
}

const config = loadConfig();
const errors = [];
const warnings = [];

console.log('🤖 Telegram AI Bot deployment doctor');
console.log('');

if (!config.botToken || config.botToken === 'your_telegram_bot_token') {
  errors.push('BOT_TOKEN 未配置。');
} else {
  ok(`BOT_TOKEN: ${mask(config.botToken)}`);
}

ok(`AI_PROVIDER: ${config.aiProvider}`);
ok(`AI_MODEL: ${config.defaultModel || 'missing'}`);
ok(`AI_FALLBACK_MODELS: ${(config.availableModels || []).join(', ') || 'none'}`);
ok(`TRANSLATION_MODEL: ${config.translationModel || config.defaultModel || 'missing'}`);
ok(`ROUTER_MODEL: ${config.routerModel || config.defaultModel || 'missing'}`);

const provider = String(config.aiProvider || '').toLowerCase();

if (provider === 'gemini' || provider === 'gemini-live') {
  if (!hasEnv('GEMINI_API_KEY', 'AI_API_KEY')) {
    errors.push('Gemini 模式需要 GEMINI_API_KEY，或用 AI_API_KEY 复用。');
  } else {
    ok(`GEMINI_API_KEY / AI_API_KEY: ${mask(process.env.GEMINI_API_KEY || process.env.AI_API_KEY)}`);
  }
}

if (provider === 'openai-compatible') {
  if (!hasEnv('AI_API_KEY')) {
    errors.push('openai-compatible 模式需要 AI_API_KEY。');
  } else {
    ok(`AI_API_KEY: ${mask(process.env.AI_API_KEY)}`);
  }

  if (!config.aiBaseUrl) {
    errors.push('openai-compatible 模式需要 AI_BASE_URL。');
  } else {
    ok(`AI_BASE_URL: ${config.aiBaseUrl}`);
  }
}

if (provider === 'anthropic' && !hasEnv('ANTHROPIC_API_KEY', 'AI_API_KEY')) {
  errors.push('Anthropic 模式需要 ANTHROPIC_API_KEY，或用 AI_API_KEY 复用。');
}

if (provider === 'qwen' && !hasEnv('QWEN_API_KEY', 'AI_API_KEY')) {
  errors.push('Qwen 模式需要 QWEN_API_KEY，或用 AI_API_KEY 复用。');
}

if (provider === 'grok' && !hasEnv('GROK_API_KEY', 'AI_API_KEY')) {
  errors.push('Grok 模式需要 GROK_API_KEY，或用 AI_API_KEY 复用。');
}

if (provider === 'deepseek' && !hasEnv('DEEPSEEK_API_KEY', 'AI_API_KEY')) {
  errors.push('DeepSeek 模式需要 DEEPSEEK_API_KEY，或用 AI_API_KEY 复用。');
}

if (provider === 'glm' && !hasEnv('GLM_API_KEY', 'AI_API_KEY')) {
  errors.push('GLM 模式需要 GLM_API_KEY，或用 AI_API_KEY 复用。');
}

if (provider === 'doubao' && !hasEnv('DOUBAO_API_KEY', 'AI_API_KEY')) {
  errors.push('Doubao 模式需要 DOUBAO_API_KEY，或用 AI_API_KEY 复用。');
}

const dbPath = config.databaseFile || '';
if (!dbPath) {
  errors.push('DATABASE_FILE 未配置。');
} else {
  ok(`DATABASE_FILE: ${dbPath}`);

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    warnings.push(`数据库目录不存在：${dir}。如果在 Zeabur 上使用挂载盘，确认已挂载到这个目录。`);
  }
}

ok(`HEALTH_PORT: ${config.healthPort}`);

if (!process.env.HEALTH_PORT && !process.env.PORT) {
  warnings.push('没有设置 HEALTH_PORT 或 PORT。Zeabur 建议设置 PORT=8080 或 HEALTH_PORT=8080。');
}

if (config.aiProvider === 'gemini' && String(config.defaultModel || '').includes('live')) {
  warnings.push('AI_PROVIDER=gemini 但 AI_MODEL 看起来是 Live 模型。Live 模型建议后续单独用 gemini-live 能力接入。');
}

if (String(config.translationModel || '').includes('native-audio') || String(config.routerModel || '').includes('native-audio')) {
  warnings.push('TRANSLATION_MODEL / ROUTER_MODEL 不建议使用 native-audio Live 模型，容易浪费额度或不兼容。');
}

console.log('');

if (warnings.length) {
  console.log('Warnings:');
  for (const item of warnings) warn(item);
  console.log('');
}

if (errors.length) {
  console.log('Errors:');
  for (const item of errors) fail(item);
  console.log('');
  process.exit(1);
}

console.log('✅ Doctor passed. 配置看起来可以启动。');
