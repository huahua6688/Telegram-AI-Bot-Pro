import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const APP_HTML = readFileSync(new URL('../mini-app/index.html', import.meta.url), 'utf8');
const APP_CSS = readFileSync(new URL('../mini-app/styles.css', import.meta.url), 'utf8');
const APP_JS = readFileSync(new URL('../mini-app/app.js', import.meta.url), 'utf8');

const LANGUAGE_OPTIONS = [
  ['auto', '自动 / Telegram'],
  ['zh', '简体中文'],
  ['zh-hant', '繁體中文'],
  ['en', 'English'],
  ['km', 'ភាសាខ្មែរ'],
  ['ms', 'Bahasa Melayu'],
  ['id', 'Bahasa Indonesia'],
  ['ko', '한국어'],
  ['ja', '日本語'],
  ['th', 'ไทย'],
  ['vi', 'Tiếng Việt'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['ru', 'Русский'],
  ['tr', 'Türkçe'],
  ['ar', 'العربية'],
  ['fa', 'فارسی'],
  ['hi', 'हिन्दी'],
  ['uk', 'Українська'],
  ['pl', 'Polski'],
  ['nl', 'Nederlands']
];

const PERSONA_LABELS = {
  default: '通用助手',
  coder: '程序员',
  translator: '翻译官',
  teacher: '老师',
  writer: '写作助手'
};

function write(res, status, body, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': contentType.startsWith('text/html') ? 'no-store' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

function json(res, status, payload) {
  write(res, status, JSON.stringify(payload), 'application/json; charset=utf-8', {
    'Cache-Control': 'no-store'
  });
}

async function readJson(req, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function safeEqualHex(left = '', right = '') {
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateTelegramInitData(initData = '', botToken = '', maxAgeSeconds = 86400) {
  const raw = String(initData || '').trim();
  const token = String(botToken || '').trim();
  if (!raw || !token) return null;

  try {
    const params = new URLSearchParams(raw);
    const providedHash = params.get('hash') || '';
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
    const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (!safeEqualHex(providedHash, expectedHash)) return null;

    const authDate = Number(params.get('auth_date') || 0);
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (!authDate || ageSeconds < -60 || ageSeconds > Math.max(60, Number(maxAgeSeconds) || 86400)) {
      return null;
    }

    const user = JSON.parse(params.get('user') || '{}');
    if (!user?.id) return null;

    return {
      user,
      queryId: params.get('query_id') || '',
      authDate
    };
  } catch {
    return null;
  }
}

function publicUser(user = {}) {
  return {
    id: String(user.id || ''),
    firstName: user.first_name || user.firstName || '',
    lastName: user.last_name || user.lastName || '',
    username: user.username || '',
    languageCode: user.language_code || user.languageCode || ''
  };
}

function miniAppCsp() {
  return [
    "default-src 'self'",
    "script-src 'self' https://telegram.org",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-ancestors https://web.telegram.org https://*.telegram.org"
  ].join('; ');
}

export function createMiniAppHandler({ db, config, logger, bot = null }) {
  const enabled = config.miniAppEnabled !== false;
  const languageCodes = new Set(LANGUAGE_OPTIONS.map(([code]) => code));
  const personaNames = Object.keys(config.personaPresets || PERSONA_LABELS);

  function authenticate(req, res) {
    const auth = validateTelegramInitData(
      req.headers['x-telegram-init-data'],
      config.botToken,
      config.miniAppAuthMaxAgeSeconds
    );
    if (!auth) {
      json(res, 401, { ok: false, error: 'TELEGRAM_AUTH_INVALID' });
      return null;
    }
    return auth;
  }

  return async function handleMiniApp(req, res, url) {
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    if (!enabled) return false;

    if (pathname === '/' || pathname === '/app' || pathname === '/mini-app') {
      write(res, 200, APP_HTML, 'text/html; charset=utf-8', {
        'Content-Security-Policy': miniAppCsp(),
        'Referrer-Policy': 'no-referrer'
      });
      return true;
    }

    if (pathname === '/mini-app/styles.css') {
      write(res, 200, APP_CSS, 'text/css; charset=utf-8');
      return true;
    }

    if (pathname === '/mini-app/app.js') {
      write(res, 200, APP_JS, 'text/javascript; charset=utf-8');
      return true;
    }

    if (!pathname.startsWith('/mini-app/api/')) return false;

    const auth = authenticate(req, res);
    if (!auth) return true;

    const telegramUser = auth.user;
    const userId = String(telegramUser.id);
    const chatId = userId;

    try {
      await db.upsertUser(telegramUser, {
        isAdmin: config.adminUserIds?.has?.(userId) || false
      });

      if (pathname === '/mini-app/api/bootstrap' && req.method === 'GET') {
        const user = db.findUser(userId) || {};
        json(res, 200, {
          ok: true,
          user: publicUser(telegramUser),
          settings: {
            model: user.preferredModel || config.defaultModel,
            persona: user.persona || 'default',
            language: user.preferredLanguage || 'auto'
          },
          options: {
            models: config.availableModels || [config.defaultModel].filter(Boolean),
            personas: personaNames.map((id) => ({ id, label: PERSONA_LABELS[id] || id })),
            languages: LANGUAGE_OPTIONS.map(([id, label]) => ({ id, label }))
          },
          capabilities: {
            webSearch: Boolean(config.enableWebSearch),
            image: true,
            translation: true,
            memory: true
          }
        });
        return true;
      }

      if (pathname === '/mini-app/api/settings' && req.method === 'POST') {
        const payload = await readJson(req);
        const patch = {};

        if (typeof payload.model === 'string') {
          if (!(config.availableModels || []).includes(payload.model)) {
            return json(res, 400, { ok: false, error: 'MODEL_INVALID' });
          }
          patch.preferredModel = payload.model;
        }
        if (typeof payload.persona === 'string') {
          if (!personaNames.includes(payload.persona)) {
            return json(res, 400, { ok: false, error: 'PERSONA_INVALID' });
          }
          patch.persona = payload.persona;
          patch.customSystemPrompt = '';
        }
        if (typeof payload.language === 'string') {
          if (!languageCodes.has(payload.language)) {
            return json(res, 400, { ok: false, error: 'LANGUAGE_INVALID' });
          }
          patch.preferredLanguage = payload.language;
        }

        const updated = await db.setUserSettings(userId, patch);
        if (patch.preferredLanguage && bot?.setChatBotCommands) {
          const effectiveLanguage = patch.preferredLanguage === 'auto'
            ? telegramUser.language_code || 'en'
            : patch.preferredLanguage;
          await bot.setChatBotCommands({ chat: { id: Number(userId) } }, effectiveLanguage);
        }

        json(res, 200, {
          ok: true,
          settings: {
            model: updated?.preferredModel || config.defaultModel,
            persona: updated?.persona || 'default',
            language: updated?.preferredLanguage || 'auto'
          }
        });
        return true;
      }

      if (pathname === '/mini-app/api/memory/clear' && req.method === 'POST') {
        await db.clearConversation(`${chatId}:${userId}:main`);
        const memoryCount = db.deleteMemoryItems?.({ userId, chatId }) || 0;
        const topicCount = db.clearTopicStates?.({ userId, chatId }) || 0;
        db.clearActiveContext?.({ userId, chatId });
        json(res, 200, { ok: true, memoryCount, topicCount });
        return true;
      }

      if (pathname === '/mini-app/api/action' && req.method === 'POST') {
        if (!bot?.handleMiniAppRequest) {
          return json(res, 503, { ok: false, error: 'BOT_NOT_READY' });
        }
        const payload = await readJson(req);
        await bot.handleMiniAppRequest({
          user: telegramUser,
          action: String(payload.action || 'chat'),
          text: String(payload.text || '').slice(0, config.maxInputChars || 12000),
          targetLanguage: String(payload.targetLanguage || 'auto')
        });
        json(res, 200, { ok: true, delivered: true });
        return true;
      }

      json(res, 404, { ok: false, error: 'NOT_FOUND' });
      return true;
    } catch (error) {
      logger.error('Mini App request failed', {
        path: pathname,
        userId,
        error: error.message
      });
      json(res, 500, { ok: false, error: 'MINI_APP_REQUEST_FAILED' });
      return true;
    }
  };
}
