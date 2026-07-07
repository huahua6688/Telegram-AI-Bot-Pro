import http from 'node:http';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
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

export function startHealthServer({ port, db, config, logger }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

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
      availableRoutes: ['/', '/health', '/ready']
    });
  });

  server.listen(port, () => {
    logger.info(`Health server listening on :${port}`, {
      routes: ['/', '/health', '/ready']
    });
  });

  return server;
}
