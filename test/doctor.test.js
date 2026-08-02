import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PROVIDER_ENV_NAMES = [
  'AI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_LIVE_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'GITHUB_MODELS_API_KEY',
  'GITHUB_TOKEN',
  'HUGGINGFACE_API_KEY',
  'HF_TOKEN',
  'MISTRAL_API_KEY',
  'DEEPSEEK_API_KEY',
  'QWEN_API_KEY',
  'GROK_API_KEY',
  'GLM_API_KEY',
  'DOUBAO_API_KEY'
];

function createDoctorEnv(tempDir, overrides = {}) {
  const env = { ...process.env };
  for (const name of [
    ...PROVIDER_ENV_NAMES,
    'BRAVE_SEARCH_API_KEY',
    'SUPPORT_BOT_TOKEN',
    'SUPPORT_ADMIN_IDS'
  ]) {
    delete env[name];
  }

  Object.assign(env, {
    DOTENV_CONFIG_PATH: path.join(tempDir, 'missing.env'),
    BOT_TOKEN: '123456:test-token',
    ADMIN_USER_IDS: '123456',
    DEFAULT_AI_PROVIDER: 'gemini',
    DEFAULT_AI_MODEL: 'gemini-2.5-flash',
    ENABLE_PROVIDER_FALLBACK: 'false',
    ENABLE_WEB_SEARCH: 'false',
    ENABLE_LIVE_AUDIO: 'false',
    ENABLE_LIVE_TRANSLATE: 'false',
    ENABLE_STARTUP_DIAGNOSTICS: 'true',
    SHOW_VERSION_INFO: 'true',
    HEALTH_CHECK_ENABLED: 'true',
    SUPPORT_ENABLED: 'false',
    PORT: '8080',
    HEALTH_PORT: '8080',
    DATABASE_FILE: path.join(tempDir, 'bot-data.db'),
    DATA_FILE: path.join(tempDir, 'bot-data.json'),
    ...overrides
  });
  return env;
}

function runDoctor(env) {
  return spawnSync(process.execPath, ['scripts/doctor.js'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8'
  });
}

test('deployment doctor accepts one configured provider and warns that fallback is not independent', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-doctor-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const env = createDoctorEnv(tempDir, {
    GEMINI_API_KEY: 'test-gemini-key',
    ENABLE_PROVIDER_FALLBACK: 'true',
  });

  const result = runDoctor(env);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /ReferenceError|envNames is not defined/);
  assert.match(output, /fewer than two independent chat providers/i);
});

test('deployment doctor fails when startup diagnostics requires a missing chat provider', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-doctor-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const result = runDoctor(createDoctorEnv(tempDir, {
    SHOW_VERSION_INFO: 'false',
    HEALTH_CHECK_ENABLED: 'false'
  }));
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.equal(result.status, 1, output);
  assert.match(output, /MISSING_AI_PROVIDER_CONFIG/);
  assert.doesNotMatch(output, /bot can start/i);
  assert.match(output, /ENABLE_STARTUP_DIAGNOSTICS: true/);
  assert.match(output, /SHOW_VERSION_INFO: false/);
  assert.match(output, /HEALTH_CHECK_ENABLED: false/);
});

test('deployment doctor warns instead of failing for a missing provider when diagnostics is disabled', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-doctor-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const result = runDoctor(createDoctorEnv(tempDir, {
    ENABLE_STARTUP_DIAGNOSTICS: 'false'
  }));
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /WARN ENABLE_STARTUP_DIAGNOSTICS=false; MISSING_AI_PROVIDER_CONFIG/);
  assert.doesNotMatch(output, /bot can start/i);
});

test('deployment doctor reports support token conflicts and missing support administrators', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-ai-bot-pro-doctor-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));

  const result = runDoctor(createDoctorEnv(tempDir, {
    GEMINI_API_KEY: 'test-gemini-key',
    SUPPORT_ENABLED: 'true',
    SUPPORT_BOT_TOKEN: '123456:test-token',
    SUPPORT_ADMIN_IDS: ''
  }));
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;

  assert.equal(result.status, 1, output);
  assert.match(output, /SUPPORT_BOT_TOKEN_CONFLICT/);
  assert.match(output, /MISSING_SUPPORT_ADMIN_IDS/);
});
