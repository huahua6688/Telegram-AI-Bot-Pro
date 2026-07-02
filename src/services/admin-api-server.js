import http from 'node:http';
import { URL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { withRequestContext } from '../core/observability/request-context.js';
import { listAIProviderDefinitions } from './ai-provider-registry.js';

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function sanitizePrefix(prefix = '/admin/api/v1') {
  const trimmed = String(prefix || '').trim();
  if (!trimmed) return '/admin/api/v1';
  return trimmed.startsWith('/') ? trimmed.replace(/\/$/, '') : `/${trimmed.replace(/\/$/, '')}`;
}

function paginate(urlObj) {
  const limit = Math.max(1, Math.min(500, Number(urlObj.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(urlObj.searchParams.get('offset')) || 0);
  return { limit, offset };
}

function parseAuthorizationToken(req) {
  const header = req.headers.authorization || '';
  if (typeof header !== 'string') return '';
  const lower = header.toLowerCase();
  if (!lower.startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

function tokenEquals(provided = '', expected = '') {
  const maxLength = Math.max(String(provided || '').length, String(expected || '').length, 64);
  const left = Buffer.alloc(maxLength);
  const right = Buffer.alloc(maxLength);
  left.write(String(provided || ''), 0, 'utf8');
  right.write(String(expected || ''), 0, 'utf8');
  return timingSafeEqual(left, right) && String(provided || '').length === String(expected || '').length;
}

function splitPath(pathname, prefix) {
  const normalized = pathname.replace(/\/$/, '');
  if (!normalized.startsWith(prefix)) return null;
  const suffix = normalized.slice(prefix.length).replace(/^\/+/, '');
  return suffix ? suffix.split('/') : [];
}

export function startAdminApiServer({ config, db, logger, accessControl, port = 3001 }) {
  const prefix = sanitizePrefix(config.adminApiPrefix);
  const token = String(config.adminApiToken || '');
  if (!config.adminApiEnabled || !token) {
    logger.info('Admin API disabled (missing token or disabled via config).');
    return null;
  }

  async function handle(req, res) {
    const requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return withRequestContext({ requestId }, async () => {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const path = splitPath(urlObj.pathname, prefix);
      if (path === null) {
        return json(res, 404, { error: 'NOT_FOUND' });
      }

      if (!tokenEquals(parseAuthorizationToken(req), token)) {
        db.logAudit({
          actorType: 'admin_api',
          action: 'auth.failed',
          result: 'deny',
          requestId: String(requestId),
          ip: req.socket.remoteAddress || '',
          userAgent: req.headers['user-agent'] || '',
          details: { path: urlObj.pathname, method: req.method }
        });
        return json(res, 401, { error: 'UNAUTHORIZED' });
      }

      const actorId = String(req.headers['x-admin-user-id'] || 'admin_api');
      const actorRoles = db.listUserRoleNames(actorId);
      const permissionDenied = (permission) => !accessControl.hasPermission(actorId, permission);
      const denyForbidden = (permission) => {
        db.logAudit({
          actorId,
          actorType: 'admin_api',
          action: 'auth.forbidden',
          targetType: 'permission',
          targetId: permission,
          result: 'deny',
          requestId: String(requestId),
          ip: req.socket.remoteAddress || '',
          userAgent: req.headers['user-agent'] || '',
          details: { path: urlObj.pathname, method: req.method, roles: actorRoles }
        });
        json(res, 403, { error: 'FORBIDDEN', permission });
      };

      try {
        if (path[0] === 'users' && req.method === 'GET' && path.length === 1) {
          if (permissionDenied('users:read')) return denyForbidden('users:read');
          const { limit, offset } = paginate(urlObj);
          const q = urlObj.searchParams.get('q') || '';
          const items = db.listUsers({ q, limit, offset }).map((user) => ({
            ...user,
            roles: db.listUserRoleNames(user.id)
          }));
          return json(res, 200, { items, total: db.countUsers({ q }), limit, offset });
        }

        if (path[0] === 'users' && req.method === 'GET' && path.length === 2) {
          if (permissionDenied('users:read')) return denyForbidden('users:read');
          const user = db.findUser(path[1]);
          if (!user) return json(res, 404, { error: 'USER_NOT_FOUND' });
          return json(res, 200, {
            user,
            roles: db.listUserRoleNames(user.id),
            permissions: db.listUserPermissions(user.id)
          });
        }

        if (path[0] === 'users' && req.method === 'PATCH' && path.length === 2) {
          if (permissionDenied('users:write')) return denyForbidden('users:write');
          const payload = await readJson(req);
          const patch = {};
          if (typeof payload.isBlocked === 'boolean') patch.isBlocked = payload.isBlocked;
          if (typeof payload.isAllowed === 'boolean') patch.isAllowed = payload.isAllowed;
          if (typeof payload.isAdmin === 'boolean') patch.isAdmin = payload.isAdmin;
          if (typeof payload.preferredLanguage === 'string') patch.preferredLanguage = payload.preferredLanguage;
          if (typeof payload.preferredModel === 'string') patch.preferredModel = payload.preferredModel;
          const user = await db.setUserSettings(path[1], patch);
          if (Array.isArray(payload.roles)) {
            db.setUserRoles(path[1], payload.roles);
          }
          db.logAudit({
            actorId,
            actorType: 'admin_api',
            action: 'users.update',
            targetType: 'user',
            targetId: path[1],
            requestId: String(requestId),
            ip: req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
            details: payload
          });
          return json(res, 200, { user, roles: db.listUserRoleNames(path[1]) });
        }

        if (path[0] === 'sessions' && req.method === 'GET' && path.length === 1) {
          if (permissionDenied('sessions:read')) return denyForbidden('sessions:read');
          const { limit, offset } = paginate(urlObj);
          const userId = urlObj.searchParams.get('userId') || '';
          const chatId = urlObj.searchParams.get('chatId') || '';
          const status = urlObj.searchParams.get('status') || 'active';
          const items = db.listAdminSessions({ userId, chatId, status, limit, offset });
          return json(res, 200, { items, limit, offset });
        }

        if (path[0] === 'sessions' && req.method === 'GET' && path.length === 2) {
          if (permissionDenied('sessions:read')) return denyForbidden('sessions:read');
          const session = db.findSession(path[1]);
          if (!session) return json(res, 404, { error: 'SESSION_NOT_FOUND' });
          return json(res, 200, {
            session,
            messages: db.getSessionMessageSummary(path[1], { limit: Math.max(1, Number(urlObj.searchParams.get('limit')) || 20) })
          });
        }

        if (path[0] === 'sessions' && req.method === 'PATCH' && path.length === 2) {
          if (permissionDenied('sessions:write')) return denyForbidden('sessions:write');
          const payload = await readJson(req);
          const status = payload.status || 'active';
          const session = await db.setSessionStatus(path[1], status);
          db.logAudit({
            actorId,
            actorType: 'admin_api',
            action: 'sessions.update_status',
            targetType: 'session',
            targetId: path[1],
            requestId: String(requestId),
            ip: req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
            details: { status }
          });
          return json(res, 200, { session });
        }

        if (path[0] === 'quota' && req.method === 'GET' && path.length === 1) {
          if (permissionDenied('quota:read')) return denyForbidden('quota:read');
          const userId = urlObj.searchParams.get('userId') || '';
          if (userId) {
            const user = db.findUser(userId);
            if (!user) return json(res, 404, { error: 'USER_NOT_FOUND' });
            return json(res, 200, {
              userId: user.id,
              dailyUsageDate: user.dailyUsageDate,
              dailyUsageCount: user.dailyUsageCount,
              dailyQuota: config.dailyQuota
            });
          }
          return json(res, 200, {
            dailyQuota: config.dailyQuota,
            summary: db.getOperationsMetrics()
          });
        }

        if (path[0] === 'quota' && req.method === 'PATCH' && path.length === 1) {
          if (permissionDenied('quota:write')) return denyForbidden('quota:write');
          const payload = await readJson(req);
          if (payload.userId) {
            const user = db.setUserDailyUsage(payload.userId, payload.dailyUsageCount || 0, payload.date);
            db.logAudit({
              actorId,
              actorType: 'admin_api',
              action: 'quota.user_update',
              targetType: 'user',
              targetId: String(payload.userId),
              requestId: String(requestId),
              ip: req.socket.remoteAddress || '',
              userAgent: req.headers['user-agent'] || '',
              details: payload
            });
            return json(res, 200, { user });
          }
          db.resetDailyUsageForAll(payload.date);
          db.logAudit({
            actorId,
            actorType: 'admin_api',
            action: 'quota.reset_all',
            targetType: 'quota',
            targetId: 'all',
            requestId: String(requestId),
            ip: req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
            details: payload
          });
          return json(res, 200, { ok: true });
        }

        if (path[0] === 'providers' && req.method === 'GET' && path.length === 1) {
          if (permissionDenied('providers:read')) return denyForbidden('providers:read');
          const providerConfigs = db.listProviderConfigs();
          const providerConfigMap = new Map(providerConfigs.map((item) => [item.providerId, item]));
          const providers = listAIProviderDefinitions().map((item) => {
            const dynamic = providerConfigMap.get(item.id);
            return {
              id: item.id,
              displayName: item.displayName,
              enabled: dynamic ? dynamic.enabled : true,
              isDefault: dynamic ? dynamic.isDefault : config.aiProvider === item.id,
              capabilities: dynamic?.capabilities?.length ? dynamic.capabilities : item.capabilities || [],
              meta: dynamic?.meta || {}
            };
          });
          return json(res, 200, { items: providers });
        }

        if (path[0] === 'providers' && req.method === 'PATCH' && path.length === 2) {
          if (permissionDenied('providers:write')) return denyForbidden('providers:write');
          const payload = await readJson(req);
          const result = db.upsertProviderConfig({
            providerId: path[1],
            enabled: payload.enabled !== false,
            isDefault: Boolean(payload.isDefault),
            capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
            meta: payload.meta || {}
          });
          db.logAudit({
            actorId,
            actorType: 'admin_api',
            action: 'providers.update',
            targetType: 'provider',
            targetId: path[1],
            requestId: String(requestId),
            ip: req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
            details: payload
          });
          return json(res, 200, { item: result });
        }

        if (path[0] === 'models' && req.method === 'GET' && path.length === 1) {
          if (permissionDenied('providers:read')) return denyForbidden('providers:read');
          const models = db.listModelConfigs();
          return json(res, 200, {
            items:
              models.length > 0
                ? models
                : config.availableModels.map((model) => ({
                    modelId: model,
                    providerId: '',
                    enabled: true,
                    isDefault: model === config.defaultModel,
                    meta: {}
                  }))
          });
        }

        if (path[0] === 'models' && req.method === 'PATCH' && path.length === 2) {
          if (permissionDenied('providers:write')) return denyForbidden('providers:write');
          const payload = await readJson(req);
          const item = db.upsertModelConfig({
            modelId: path[1],
            providerId: payload.providerId || '',
            enabled: payload.enabled !== false,
            isDefault: Boolean(payload.isDefault),
            meta: payload.meta || {}
          });
          db.logAudit({
            actorId,
            actorType: 'admin_api',
            action: 'models.update',
            targetType: 'model',
            targetId: path[1],
            requestId: String(requestId),
            ip: req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
            details: payload
          });
          return json(res, 200, { item });
        }

        if (path[0] === 'flags' && req.method === 'GET' && path.length === 1) {
          if (permissionDenied('flags:read')) return denyForbidden('flags:read');
          const items = db.listFeatureFlags({
            flagKey: urlObj.searchParams.get('flagKey') || '',
            scopeType: urlObj.searchParams.get('scopeType') || '',
            scopeId: urlObj.searchParams.get('scopeId') || '',
            limit: Number(urlObj.searchParams.get('limit')) || 200
          });
          return json(res, 200, { items });
        }

        if (path[0] === 'flags' && req.method === 'PUT' && path.length === 1) {
          if (permissionDenied('flags:write')) return denyForbidden('flags:write');
          const payload = await readJson(req);
          const item = db.upsertFeatureFlag({
            flagKey: payload.flagKey,
            scopeType: payload.scopeType || 'global',
            scopeId: payload.scopeId || '',
            enabled: payload.enabled !== false,
            payload: payload.payload || {},
            updatedBy: actorId
          });
          db.logAudit({
            actorId,
            actorType: 'admin_api',
            action: 'flags.upsert',
            targetType: 'feature_flag',
            targetId: payload.flagKey || '',
            requestId: String(requestId),
            ip: req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
            details: payload
          });
          return json(res, 200, { item });
        }

        if (path[0] === 'policies' && req.method === 'GET' && path.length === 1) {
          if (permissionDenied('policy:read')) return denyForbidden('policy:read');
          return json(res, 200, {
            items: db.listPolicyRules({
              effect: urlObj.searchParams.get('effect') || '',
              subjectType: urlObj.searchParams.get('subjectType') || '',
              subjectId: urlObj.searchParams.get('subjectId') || '',
              limit: Number(urlObj.searchParams.get('limit')) || 200
            })
          });
        }

        if (path[0] === 'policies' && req.method === 'PUT' && path.length === 1) {
          if (permissionDenied('policy:write')) return denyForbidden('policy:write');
          const payload = await readJson(req);
          const item = db.upsertPolicyRule({
            id: payload.id || '',
            effect: payload.effect || 'allow',
            subjectType: payload.subjectType || 'user',
            subjectId: payload.subjectId || '',
            enabled: payload.enabled !== false,
            note: payload.note || '',
            createdBy: actorId
          });
          db.logAudit({
            actorId,
            actorType: 'admin_api',
            action: 'policy.upsert',
            targetType: 'policy_rule',
            targetId: item?.id || '',
            requestId: String(requestId),
            ip: req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
            details: payload
          });
          return json(res, 200, { item });
        }

        if (path[0] === 'audit' && req.method === 'GET' && path.length === 1) {
          if (permissionDenied('audit:read')) return denyForbidden('audit:read');
          const { limit, offset } = paginate(urlObj);
          const items = db.listAuditLogs({
            actorId: urlObj.searchParams.get('actorId') || '',
            action: urlObj.searchParams.get('action') || '',
            targetType: urlObj.searchParams.get('targetType') || '',
            keyword: urlObj.searchParams.get('keyword') || '',
            from: urlObj.searchParams.get('from') || '',
            to: urlObj.searchParams.get('to') || '',
            limit,
            offset
          });
          if ((urlObj.searchParams.get('format') || '').toLowerCase() === 'csv') {
            const lines = ['id,actorId,action,targetType,targetId,result,createdAt'];
            for (const item of items) {
              lines.push(
                [item.id, item.actorId, item.action, item.targetType, item.targetId, item.result, item.createdAt]
                  .map((value) => `"${String(value || '').replace(/"/g, '""')}"`)
                  .join(',')
              );
            }
            res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
            res.end(lines.join('\n'));
            return;
          }
          return json(res, 200, { items, limit, offset });
        }

        if (path[0] === 'ops' && req.method === 'GET' && path.length === 1) {
          if (permissionDenied('audit:read')) return denyForbidden('audit:read');
          return json(res, 200, db.getOperationsMetrics());
        }

        return json(res, 404, { error: 'NOT_FOUND' });
      } catch (error) {
        logger.error('Admin API request failed', { error: error.message, path: req.url });
        db.logAudit({
          actorId: String(req.headers['x-admin-user-id'] || ''),
          actorType: 'admin_api',
          action: 'request.error',
          targetType: 'http',
          targetId: req.url || '',
          result: 'error',
          requestId: String(requestId),
          ip: req.socket.remoteAddress || '',
          userAgent: req.headers['user-agent'] || '',
          details: { message: error.message }
        });
        return json(res, 500, { error: 'INTERNAL_ERROR', message: error.message });
      }
    });
  }

  const server = http.createServer((req, res) => void handle(req, res));
  server.listen(port, () => {
    logger.info(`Admin API server listening on :${port}${prefix}`);
  });
  return server;
}
