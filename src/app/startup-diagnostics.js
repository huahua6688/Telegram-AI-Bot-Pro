import fs from 'node:fs';
import path from 'node:path';
import { getBuildInfo } from './build-info.js';

export const StartupDiagnosticCodes = Object.freeze({
  MISSING_TELEGRAM_BOT_TOKEN: 'MISSING_TELEGRAM_BOT_TOKEN',
  MISSING_AI_PROVIDER_CONFIG: 'MISSING_AI_PROVIDER_CONFIG',
  INVALID_PORT: 'INVALID_PORT',
  DATABASE_PATH_NOT_FOUND: 'DATABASE_PATH_NOT_FOUND',
  DATABASE_PATH_NOT_WRITABLE: 'DATABASE_PATH_NOT_WRITABLE',
  GEMINI_LIVE_CONFIG_MISSING: 'GEMINI_LIVE_CONFIG_MISSING',
  DATABASE_FILE_NOT_CREATED: 'DATABASE_FILE_NOT_CREATED',
  GIT_COMMIT_UNAVAILABLE: 'GIT_COMMIT_UNAVAILABLE',
  NODE_ENV_NOT_SET: 'NODE_ENV_NOT_SET',
  UNSUPPORTED_NODE_VERSION: 'UNSUPPORTED_NODE_VERSION'
});

const PROVIDER_SPECS = Object.freeze({
  gemini: {
    credentialKey: 'geminiApiKey',
    credentialEnv: ['GEMINI_API_KEY'],
    baseUrlKey: 'geminiBaseUrl',
    baseUrlEnv: ['GEMINI_BASE_URL'],
    modelEnv: ['GEMINI_MODEL'],
    legacyCredential: true
  },
  'gemini-live': {
    credentialKey: 'geminiLiveApiKey',
    credentialEnv: ['GEMINI_LIVE_API_KEY'],
    baseUrlKey: 'geminiLiveBaseUrl',
    baseUrlEnv: ['GEMINI_LIVE_BASE_URL'],
    modelEnv: ['GEMINI_LIVE_MODEL', 'GEMINI_LIVE_TRANSCRIPTION_MODEL', 'GEMINI_LIVE_TTS_MODEL']
  },
  'openai-compatible': {
    credentialKey: 'aiApiKey',
    credentialEnv: ['AI_API_KEY'],
    baseUrlKey: 'aiBaseUrl',
    baseUrlEnv: ['AI_BASE_URL'],
    modelEnv: ['AI_MODEL']
  },
  openai: {
    credentialKey: 'openaiApiKey',
    credentialEnv: ['OPENAI_API_KEY'],
    modelEnv: ['OPENAI_MODEL'],
    legacyCredential: true
  },
  anthropic: {
    credentialKey: 'anthropicApiKey',
    credentialEnv: ['ANTHROPIC_API_KEY'],
    modelEnv: ['ANTHROPIC_MODEL'],
    legacyCredential: true
  },
  groq: {
    credentialKey: 'groqApiKey',
    credentialEnv: ['GROQ_API_KEY'],
    modelEnv: ['GROQ_MODEL']
  },
  openrouter: {
    credentialKey: 'openrouterApiKey',
    credentialEnv: ['OPENROUTER_API_KEY'],
    modelEnv: ['OPENROUTER_MODEL']
  },
  'github-models': {
    credentialKey: 'githubModelsApiKey',
    credentialEnv: ['GITHUB_MODELS_API_KEY', 'GITHUB_TOKEN'],
    modelEnv: ['GITHUB_MODELS_MODEL']
  },
  huggingface: {
    credentialKey: 'huggingfaceApiKey',
    credentialEnv: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
    modelEnv: ['HUGGINGFACE_MODEL']
  },
  mistral: {
    credentialKey: 'mistralApiKey',
    credentialEnv: ['MISTRAL_API_KEY'],
    modelEnv: ['MISTRAL_MODEL']
  },
  qwen: {
    credentialKey: 'qwenApiKey',
    credentialEnv: ['QWEN_API_KEY'],
    modelEnv: ['QWEN_MODEL'],
    legacyCredential: true
  },
  grok: {
    credentialKey: 'grokApiKey',
    credentialEnv: ['GROK_API_KEY'],
    modelEnv: ['GROK_MODEL'],
    legacyCredential: true
  },
  deepseek: {
    credentialKey: 'deepseekApiKey',
    credentialEnv: ['DEEPSEEK_API_KEY'],
    modelEnv: ['DEEPSEEK_MODEL'],
    legacyCredential: true
  },
  glm: {
    credentialKey: 'glmApiKey',
    credentialEnv: ['GLM_API_KEY'],
    modelEnv: ['GLM_MODEL'],
    legacyCredential: true
  },
  doubao: {
    credentialKey: 'doubaoApiKey',
    credentialEnv: ['DOUBAO_API_KEY'],
    modelEnv: ['DOUBAO_MODEL'],
    legacyCredential: true
  }
});

function firstNonEmpty(...values) {
  return values
    .flat()
    .map((value) => String(value ?? '').trim())
    .find(Boolean) || '';
}

function compactList(...values) {
  return Array.from(new Set(
    values
      .flat()
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
  ));
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeProvider(value = '') {
  const provider = String(value || '').trim().toLowerCase();
  const aliases = {
    compatible: 'openai-compatible',
    custom: 'openai-compatible',
    google: 'gemini',
    gemini_live: 'gemini-live',
    'google-live': 'gemini-live',
    'open-router': 'openrouter',
    github: 'github-models',
    github_models: 'github-models',
    hf: 'huggingface',
    'hugging-face': 'huggingface',
    claude: 'anthropic'
  };
  return aliases[provider] || provider;
}

function issue(severity, code, message, field = '', details = {}) {
  return Object.freeze({
    severity,
    code,
    message,
    ...(field ? { field } : {}),
    ...(Object.keys(details).length > 0 ? { details: Object.freeze({ ...details }) } : {})
  });
}

function providerModels(config, env, providerId, spec, selectedProvider) {
  return compactList(
    config.providerModels?.[providerId] || [],
    config.providerDefaultModels?.[providerId],
    providerId === selectedProvider ? config.defaultModel : '',
    (spec.modelEnv || []).map((name) => env[name])
  );
}

function inspectProvider(config, env, providerId, selectedProvider) {
  const spec = PROVIDER_SPECS[providerId];
  const credential = firstNonEmpty(
    config[spec.credentialKey],
    spec.credentialEnv.map((name) => env[name]),
    providerId === selectedProvider && spec.legacyCredential ? env.AI_API_KEY : ''
  );
  const models = providerModels(config, env, providerId, spec, selectedProvider);
  const baseUrl = spec.baseUrlKey
    ? firstNonEmpty(config[spec.baseUrlKey], spec.baseUrlEnv.map((name) => env[name]))
    : 'provider-default';

  return Object.freeze({
    configured: Boolean(credential && models.length > 0 && baseUrl),
    credentialConfigured: Boolean(credential),
    credential: maskSensitiveValue(credential),
    modelConfigured: models.length > 0,
    baseUrlConfigured: Boolean(baseUrl),
    env: Object.freeze({
      credential: spec.credentialEnv.some((name) => Boolean(String(env[name] || '').trim())),
      model: (spec.modelEnv || []).some((name) => Boolean(String(env[name] || '').trim())),
      baseUrl: !spec.baseUrlEnv || spec.baseUrlEnv.some((name) => Boolean(String(env[name] || '').trim()))
    })
  });
}

function inspectDatabase({ config, env, cwd, fsImpl, errors, warnings }) {
  const connection = firstNonEmpty(config.databaseUrl, env.DATABASE_URL);
  const databaseFile = firstNonEmpty(config.databaseFile, env.DATABASE_FILE);

  if (connection) {
    return Object.freeze({
      configured: true,
      type: 'connection',
      parentDirectoryExists: true,
      writable: true,
      fileExists: false
    });
  }

  if (!databaseFile) {
    errors.push(issue(
      'error',
      StartupDiagnosticCodes.DATABASE_PATH_NOT_FOUND,
      'DATABASE_FILE or DATABASE_URL is required.',
      'DATABASE_FILE'
    ));
    return Object.freeze({
      configured: false,
      type: 'file',
      parentDirectoryExists: false,
      writable: false,
      fileExists: false
    });
  }

  if (databaseFile === ':memory:') {
    return Object.freeze({
      configured: true,
      type: 'memory',
      parentDirectoryExists: true,
      writable: true,
      fileExists: true
    });
  }

  const resolvedFile = path.resolve(cwd, databaseFile);
  const parentDirectory = path.dirname(resolvedFile);
  let parentDirectoryExists = false;
  let writable = false;
  let fileExists = false;

  try {
    parentDirectoryExists = fsImpl.statSync(parentDirectory).isDirectory();
  } catch {
    parentDirectoryExists = false;
  }

  if (!parentDirectoryExists) {
    errors.push(issue(
      'error',
      StartupDiagnosticCodes.DATABASE_PATH_NOT_FOUND,
      'The database parent directory does not exist.',
      'DATABASE_FILE'
    ));
  } else {
    try {
      fsImpl.accessSync(parentDirectory, fs.constants.W_OK);
      writable = true;
    } catch {
      errors.push(issue(
        'error',
        StartupDiagnosticCodes.DATABASE_PATH_NOT_WRITABLE,
        'The database parent directory is not writable.',
        'DATABASE_FILE'
      ));
    }
  }

  try {
    fileExists = fsImpl.statSync(resolvedFile).isFile();
  } catch {
    fileExists = false;
  }

  if (parentDirectoryExists && writable && !fileExists) {
    warnings.push(issue(
      'warning',
      StartupDiagnosticCodes.DATABASE_FILE_NOT_CREATED,
      'The database file does not exist yet and is expected to be created at startup.',
      'DATABASE_FILE'
    ));
  }

  return Object.freeze({
    configured: true,
    type: 'file',
    parentDirectoryExists,
    writable,
    fileExists
  });
}

function inspectPort(config, env, errors) {
  const raw = firstNonEmpty(env.HEALTH_PORT, env.PORT, config.healthPort, config.port);
  const validSyntax = /^\d+$/.test(raw);
  const value = validSyntax ? Number(raw) : Number.NaN;
  const valid = validSyntax && Number.isSafeInteger(value) && value >= 1 && value <= 65535;

  if (!valid) {
    errors.push(issue(
      'error',
      StartupDiagnosticCodes.INVALID_PORT,
      'PORT or HEALTH_PORT must be an integer between 1 and 65535.',
      'PORT'
    ));
  }

  return Object.freeze({ configured: Boolean(raw), valid, value: valid ? value : null });
}

function checkNodeVersion(nodeVersion, warnings) {
  const match = String(nodeVersion || '').match(/^v?(\d+)(?:\.(\d+))?/);
  if (!match) return;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  if (major < 22 || (major === 22 && minor < 5)) {
    warnings.push(issue(
      'warning',
      StartupDiagnosticCodes.UNSUPPORTED_NODE_VERSION,
      'Node.js 22.5.0 or newer is recommended.',
      'NODE_VERSION'
    ));
  }
}

export function maskSensitiveValue(value = '') {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= 8) return '****';
  return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
}

export function collectStartupDiagnostics({
  config = {},
  env = process.env,
  cwd = process.cwd(),
  fsImpl = fs,
  buildInfo = getBuildInfo({ env, cwd, fsImpl })
} = {}) {
  const errors = [];
  const warnings = [];
  const safeBuildInfo = Object.freeze({
    version: String(buildInfo?.version || 'unknown'),
    revision: String(buildInfo?.revision || ''),
    shortRevision: String(buildInfo?.shortRevision || ''),
    branch: String(buildInfo?.branch || ''),
    nodeVersion: String(buildInfo?.nodeVersion || 'unknown'),
    environment: String(buildInfo?.environment || 'development'),
    deployedAt: String(buildInfo?.deployedAt || ''),
    startedAt: String(buildInfo?.startedAt || '')
  });
  const botToken = firstNonEmpty(config.botToken, env.BOT_TOKEN);
  const tokenConfigured = Boolean(botToken && botToken !== 'your_telegram_bot_token');

  if (!tokenConfigured) {
    errors.push(issue(
      'error',
      StartupDiagnosticCodes.MISSING_TELEGRAM_BOT_TOKEN,
      'BOT_TOKEN is missing or still uses the placeholder value.',
      'BOT_TOKEN'
    ));
  }

  const selectedProvider = normalizeProvider(firstNonEmpty(
    config.aiProvider,
    config.defaultAIProvider,
    env.DEFAULT_AI_PROVIDER,
    env.AI_PROVIDER,
    'openai-compatible'
  ));
  const providerChecks = Object.fromEntries(
    Object.keys(PROVIDER_SPECS).map((providerId) => [
      providerId,
      inspectProvider(config, env, providerId, selectedProvider)
    ])
  );
  const chatProviders = Object.entries(providerChecks)
    .filter(([providerId, state]) => providerId !== 'gemini-live' && state.configured)
    .map(([providerId]) => providerId);
  const selectedProviderReady = selectedProvider === 'auto'
    ? chatProviders.length > 0
    : Boolean(providerChecks[selectedProvider]?.configured);

  if (!selectedProviderReady) {
    errors.push(issue(
      'error',
      StartupDiagnosticCodes.MISSING_AI_PROVIDER_CONFIG,
      selectedProvider === 'auto'
        ? 'At least one configured chat AI provider is required.'
        : `The selected AI provider "${selectedProvider || 'unknown'}" is incomplete.`,
      'DEFAULT_AI_PROVIDER',
      { provider: selectedProvider || 'unknown' }
    ));
  }

  const liveFeatureEnabled = Boolean(
    parseBoolean(config.enableLiveAudio, parseBoolean(env.ENABLE_LIVE_AUDIO)) ||
    parseBoolean(config.enableLiveTranslate, parseBoolean(env.ENABLE_LIVE_TRANSLATE)) ||
    selectedProvider === 'gemini-live'
  );
  const liveProviderSelected = Boolean(
    normalizeProvider(config.transcriptionProvider) === 'gemini-live' ||
    normalizeProvider(config.ttsProvider) === 'gemini-live'
  );
  const liveReady = providerChecks['gemini-live'].configured;

  if (!liveReady && liveFeatureEnabled) {
    errors.push(issue(
      'error',
      StartupDiagnosticCodes.GEMINI_LIVE_CONFIG_MISSING,
      'Gemini Live is enabled but its dedicated API key or model is missing.',
      'GEMINI_LIVE_API_KEY'
    ));
  } else if (!liveReady && liveProviderSelected) {
    warnings.push(issue(
      'warning',
      StartupDiagnosticCodes.GEMINI_LIVE_CONFIG_MISSING,
      'Gemini Live is selected for speech but its dedicated API key or model is missing.',
      'GEMINI_LIVE_API_KEY'
    ));
  }

  const database = inspectDatabase({ config, env, cwd, fsImpl, errors, warnings });
  const port = inspectPort(config, env, errors);

  if (!String(env.NODE_ENV || '').trim()) {
    warnings.push(issue(
      'warning',
      StartupDiagnosticCodes.NODE_ENV_NOT_SET,
      'NODE_ENV is not set; diagnostics report development as the fallback.',
      'NODE_ENV'
    ));
  }
  if (!safeBuildInfo.revision) {
    warnings.push(issue(
      'warning',
      StartupDiagnosticCodes.GIT_COMMIT_UNAVAILABLE,
      'The current Git commit could not be determined.',
      'GIT_COMMIT_SHA'
    ));
  }
  checkNodeVersion(safeBuildInfo.nodeVersion, warnings);

  const status = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'ok';
  const checks = Object.freeze({
    telegramBotToken: Object.freeze({
      configured: tokenConfigured,
      value: maskSensitiveValue(tokenConfigured ? botToken : '')
    }),
    aiProvider: Object.freeze({
      selected: selectedProvider,
      configured: selectedProviderReady,
      configuredChatProviders: Object.freeze([...chatProviders])
    }),
    providers: Object.freeze({
      gemini: providerChecks.gemini,
      geminiLive: providerChecks['gemini-live'],
      openAICompatible: providerChecks['openai-compatible']
    }),
    database,
    port
  });
  const summary = Object.freeze({
    status,
    version: safeBuildInfo.version,
    revision: safeBuildInfo.shortRevision,
    node: safeBuildInfo.nodeVersion,
    environment: safeBuildInfo.environment,
    provider: selectedProvider,
    model: firstNonEmpty(config.defaultModel, env.DEFAULT_AI_MODEL, env.AI_MODEL),
    port: port.value,
    database: database.type,
    startedAt: safeBuildInfo.startedAt,
    deployedAt: safeBuildInfo.deployedAt
  });

  return Object.freeze({
    ok: errors.length === 0,
    status,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    checks,
    summary,
    buildInfo: safeBuildInfo
  });
}

export const runStartupDiagnostics = collectStartupDiagnostics;

export class StartupDiagnosticsError extends Error {
  constructor(report) {
    const firstError = report?.errors?.[0];
    super(firstError ? `${firstError.code}: ${firstError.message}` : 'STARTUP_DIAGNOSTICS_FAILED');
    this.name = 'StartupDiagnosticsError';
    this.code = firstError?.code || 'STARTUP_DIAGNOSTICS_FAILED';
    this.diagnostics = report;
  }
}

export function assertStartupDiagnostics(options = {}) {
  const report = collectStartupDiagnostics(options);
  if (!report.ok) throw new StartupDiagnosticsError(report);
  return report;
}

export function logStartupDiagnostics(report, { logger = console } = {}) {
  const level = report?.ok ? (report.warnings?.length ? 'warn' : 'info') : 'error';
  logger[level]?.('Startup diagnostics completed', report?.summary || {});
  for (const item of [...(report?.errors || []), ...(report?.warnings || [])]) {
    logger[item.severity === 'error' ? 'error' : 'warn']?.(item.message, {
      code: item.code,
      field: item.field || ''
    });
  }
  return report;
}
