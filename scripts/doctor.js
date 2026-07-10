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
  console.log(`OK  ${message}`);
}

function warn(message) {
  console.log(`WARN ${message}`);
}

function fail(message) {
  console.log(`FAIL ${message}`);
}

function hasEnv(...names) {
  return names.some((name) => Boolean(String(process.env[name] || '').trim()));
}

function firstEnv(...names) {
  const name = names.find((item) => Boolean(String(process.env[item] || '').trim()));
  return name ? process.env[name] : '';
}

function checkWritableFileDirectory(filePath = '', label = 'FILE', warnings = [], errors = []) {
  const raw = String(filePath || '').trim();
  if (!raw) {
    errors.push(`${label} is not configured.`);
    return;
  }

  ok(`${label}: ${raw}`);

  const dir = path.dirname(raw);
  if (!dir || dir === '.') return;

  if (!fs.existsSync(dir)) {
    warnings.push(`${label} directory does not exist yet: ${dir}. The app will try to create it on startup.`);
    return;
  }

  try {
    fs.accessSync(dir, fs.constants.W_OK);
    const testFile = path.join(dir, `.doctor-write-test-${process.pid}`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    ok(`${label} directory writable: ${dir}`);
  } catch (error) {
    errors.push(`${label} directory is not writable: ${dir}. Error: ${error.message}`);
  }
}

const config = loadConfig();
const errors = [];
const warnings = [];

console.log('Telegram AI Bot deployment doctor');
console.log('');

if (!config.botToken || config.botToken === 'your_telegram_bot_token') {
  errors.push('BOT_TOKEN is missing or still uses the placeholder value.');
} else {
  ok(`BOT_TOKEN: ${mask(config.botToken)}`);
}

ok(`DEFAULT_AI_PROVIDER: ${config.aiProvider}`);
ok(`DEFAULT_AI_MODEL: ${config.defaultModel || 'missing'}`);
ok(`AI_PROVIDER_FALLBACK_ORDER: ${(config.aiProviderFallbackOrder || []).join(' -> ') || 'none'}`);
ok(`TRANSLATION_PROVIDER: ${config.translationProvider || '-'}`);
ok(`ROUTER_PROVIDER: ${config.routerProvider || '-'}`);

const providerChecks = [
  ['Gemini', 'gemini', ['GEMINI_API_KEY', 'AI_API_KEY']],
  ['Gemini Live', 'gemini-live', ['GEMINI_LIVE_API_KEY', 'GEMINI_API_KEY', 'AI_API_KEY']],
  ['Groq', 'groq', ['GROQ_API_KEY']],
  ['OpenRouter', 'openrouter', ['OPENROUTER_API_KEY']],
  ['GitHub Models', 'github-models', ['GITHUB_MODELS_API_KEY', 'GITHUB_TOKEN']],
  ['Hugging Face', 'huggingface', ['HUGGINGFACE_API_KEY', 'HF_TOKEN']],
  ['Mistral', 'mistral', ['MISTRAL_API_KEY']],
  ['OpenAI', 'openai', ['OPENAI_API_KEY', 'AI_API_KEY']],
  ['OpenAI Compatible', 'openai-compatible', ['AI_API_KEY']],
  ['Anthropic', 'anthropic', ['ANTHROPIC_API_KEY', 'AI_API_KEY']],
  ['DeepSeek', 'deepseek', ['DEEPSEEK_API_KEY', 'AI_API_KEY']],
  ['Qwen', 'qwen', ['QWEN_API_KEY', 'AI_API_KEY']],
  ['Grok', 'grok', ['GROK_API_KEY', 'AI_API_KEY']],
  ['GLM', 'glm', ['GLM_API_KEY', 'AI_API_KEY']],
  ['Doubao', 'doubao', ['DOUBAO_API_KEY', 'AI_API_KEY']]
];

console.log('');
console.log('AI Providers:');
let configuredProviderCount = 0;
for (const [label, providerId, envNames] of providerChecks) {
  const configured = hasEnv(...envNames);
  const models = config.providerModels?.[providerId]?.join(', ') || '';
  if (configured) configuredProviderCount += 1;
  const summary = `${label}: ${configured ? 'configured' : 'not configured'}${models ? ` / ${models}` : ''}`;
  if (configured) {
    ok(`${summary} / key ${mask(firstEnv(...envNames))}`);
  } else {
    warn(summary);
  }
}

if (configuredProviderCount === 0) {
  warnings.push('No AI provider API key is configured. The bot can start, but AI replies will fail until at least one provider key and model are set.');
}

checkWritableFileDirectory(config.databaseFile, 'DATABASE_FILE', warnings, errors);
checkWritableFileDirectory(config.legacyDataFile, 'DATA_FILE', warnings, errors);

ok(`HEALTH_PORT: ${config.healthPort}`);

if (!process.env.HEALTH_PORT && !process.env.PORT) {
  warnings.push('HEALTH_PORT or PORT is not set. Zeabur usually expects PORT=8080 or HEALTH_PORT=8080.');
}

if (!hasEnv('ADMIN_USER_IDS')) {
  warnings.push('ADMIN_USER_IDS is not configured. Send /whoami to the bot, then add your Telegram user ID.');
} else {
  ok(`ADMIN_USER_IDS: ${mask(process.env.ADMIN_USER_IDS)}`);
}

if (String(process.env.ADMIN_API_ENABLED || '').trim().toLowerCase() === 'true' && !hasEnv('ADMIN_API_TOKEN')) {
  warnings.push('ADMIN_API_ENABLED=true but ADMIN_API_TOKEN is missing.');
}

if (config.aiProvider === 'gemini' && String(config.defaultModel || '').includes('live')) {
  warnings.push('DEFAULT_AI_PROVIDER=gemini uses a Live-looking model. Use gemini-live for Live audio models.');
}

if (String(config.translationModel || '').includes('native-audio') || String(config.routerModel || '').includes('native-audio')) {
  warnings.push('TRANSLATION_MODEL / ROUTER_MODEL should not use native-audio Live models.');
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

console.log('Doctor passed.');
