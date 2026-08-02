import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getBuildInfo } from '../src/app/build-info.js';
import {
  StartupDiagnosticCodes,
  StartupDiagnosticsError,
  assertStartupDiagnostics,
  collectStartupDiagnostics,
  maskSensitiveValue
} from '../src/app/startup-diagnostics.js';

const SAFE_BUILD_INFO = Object.freeze({
  version: '9.8.7',
  revision: '0123456789abcdef0123456789abcdef01234567',
  shortRevision: '0123456789ab',
  branch: 'test',
  nodeVersion: 'v22.5.0',
  environment: 'production',
  deployedAt: '2026-08-01T00:00:00.000Z',
  startedAt: '2026-08-02T00:00:00.000Z'
});

async function createRuntimeFiles(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'startup-diagnostics-'));
  const databaseFile = path.join(directory, 'bot-data.db');
  await fs.writeFile(databaseFile, '');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, databaseFile };
}

function validConfig(databaseFile, overrides = {}) {
  return {
    botToken: '1234-telegram-secret-9876',
    aiProvider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    geminiApiKey: 'gemi-provider-secret-key-4321',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    providerModels: {
      gemini: ['gemini-2.5-flash']
    },
    databaseFile,
    healthPort: 8080,
    transcriptionProvider: 'gemini',
    ttsProvider: 'gemini',
    ...overrides
  };
}

test('maskSensitiveValue exposes only four leading and trailing characters', () => {
  assert.equal(maskSensitiveValue('1234567890abcdef'), '1234****cdef');
  assert.equal(maskSensitiveValue('12345678'), '****');
  assert.equal(maskSensitiveValue(''), '');
});

test('startup diagnostics returns a safe success summary for a complete config', async (t) => {
  const { databaseFile } = await createRuntimeFiles(t);
  const config = validConfig(databaseFile);
  const env = {
    NODE_ENV: 'production',
    GEMINI_API_KEY: config.geminiApiKey,
    GEMINI_MODEL: config.defaultModel
  };

  const report = collectStartupDiagnostics({
    config,
    env,
    buildInfo: { ...SAFE_BUILD_INFO, accidentalSecret: 'must-not-be-serialized' }
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.ok, true);
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.checks.telegramBotToken.value, '1234****9876');
  assert.equal(report.checks.providers.gemini.credential, 'gemi****4321');
  assert.equal(report.checks.providers.gemini.env.credential, true);
  assert.equal(report.checks.providers.openAICompatible.env.credential, false);
  assert.equal(report.summary.provider, 'gemini');
  assert.equal(report.summary.port, 8080);
  assert.doesNotMatch(serialized, new RegExp(config.botToken));
  assert.doesNotMatch(serialized, new RegExp(config.geminiApiKey));
  assert.doesNotMatch(serialized, /must-not-be-serialized/);
});

test('startup diagnostics emits stable codes for missing required configuration', () => {
  const report = collectStartupDiagnostics({
    config: {
      botToken: 'your_telegram_bot_token',
      aiProvider: 'auto',
      defaultModel: 'model-without-provider',
      databaseFile: path.join(os.tmpdir(), 'missing-parent-for-startup-diagnostics', 'bot.db'),
      healthPort: 'invalid'
    },
    env: { NODE_ENV: 'production' },
    buildInfo: SAFE_BUILD_INFO
  });
  const codes = new Set(report.errors.map((item) => item.code));

  assert.equal(report.ok, false);
  assert.equal(report.status, 'error');
  assert.ok(codes.has(StartupDiagnosticCodes.MISSING_TELEGRAM_BOT_TOKEN));
  assert.ok(codes.has(StartupDiagnosticCodes.MISSING_AI_PROVIDER_CONFIG));
  assert.ok(codes.has(StartupDiagnosticCodes.INVALID_PORT));
  assert.ok(codes.has(StartupDiagnosticCodes.DATABASE_PATH_NOT_FOUND));
  assert.ok(report.errors.every((item) => item.severity === 'error'));
});

test('enabled Gemini Live is an error while an unconfigured optional speech provider is a warning', async (t) => {
  const { databaseFile } = await createRuntimeFiles(t);
  const base = validConfig(databaseFile, {
    transcriptionProvider: 'gemini-live',
    providerModels: {
      gemini: ['gemini-2.5-flash'],
      'gemini-live': ['gemini-live-model']
    }
  });

  const warningReport = collectStartupDiagnostics({
    config: base,
    env: { NODE_ENV: 'production' },
    buildInfo: SAFE_BUILD_INFO
  });
  assert.equal(warningReport.ok, true);
  assert.ok(warningReport.warnings.some(
    (item) => item.code === StartupDiagnosticCodes.GEMINI_LIVE_CONFIG_MISSING
  ));

  const errorReport = collectStartupDiagnostics({
    config: { ...base, enableLiveAudio: true },
    env: { NODE_ENV: 'production' },
    buildInfo: SAFE_BUILD_INFO
  });
  assert.equal(errorReport.ok, false);
  assert.ok(errorReport.errors.some(
    (item) => item.code === StartupDiagnosticCodes.GEMINI_LIVE_CONFIG_MISSING
  ));
});

test('assertStartupDiagnostics throws the first stable diagnostic code', async (t) => {
  const { databaseFile } = await createRuntimeFiles(t);

  assert.throws(
    () => assertStartupDiagnostics({
      config: validConfig(databaseFile, { geminiApiKey: '' }),
      env: { NODE_ENV: 'production' },
      buildInfo: SAFE_BUILD_INFO
    }),
    (error) => {
      assert.ok(error instanceof StartupDiagnosticsError);
      assert.equal(error.code, StartupDiagnosticCodes.MISSING_AI_PROVIDER_CONFIG);
      return true;
    }
  );
});

test('build info prefers deployment metadata and falls back to readable Git metadata', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'build-info-'));
  const gitDirectory = path.join(directory, '.git');
  const revision = 'abcdef0123456789abcdef0123456789abcdef01';
  await fs.mkdir(path.join(gitDirectory, 'refs', 'heads'), { recursive: true });
  await fs.writeFile(path.join(gitDirectory, 'HEAD'), 'ref: refs/heads/diagnostics\n');
  await fs.writeFile(path.join(gitDirectory, 'refs', 'heads', 'diagnostics'), `${revision}\n`);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const local = getBuildInfo({
    cwd: directory,
    env: { NODE_ENV: 'test' },
    packageVersion: '1.2.3',
    nodeVersion: 'v22.5.0',
    startedAt: '2026-08-02T01:00:00Z'
  });
  assert.equal(local.revision, revision);
  assert.equal(local.branch, 'diagnostics');
  assert.equal(local.version, '1.2.3');

  const deployed = getBuildInfo({
    cwd: directory,
    env: {
      APP_VERSION: '2.0.0',
      GIT_COMMIT_SHA: 'deployment-revision',
      GIT_BRANCH: 'deployment-branch',
      NODE_ENV: 'production',
      SOURCE_DATE_EPOCH: '1785542400'
    },
    nodeVersion: 'v24.0.0',
    startedAt: '2026-08-02T01:00:00Z'
  });
  assert.equal(deployed.version, '2.0.0');
  assert.equal(deployed.revision, 'deployment-revision');
  assert.equal(deployed.branch, 'deployment-branch');
  assert.equal(deployed.environment, 'production');
  assert.equal(deployed.deployedAt, '2026-08-01T00:00:00.000Z');
});
