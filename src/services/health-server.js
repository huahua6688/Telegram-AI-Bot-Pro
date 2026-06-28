import http from 'node:http';

export function startHealthServer({ port, db, config, logger }) {
  const server = http.createServer((_req, res) => {
    const stats = db.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        model: config.defaultModel,
        uptime: process.uptime(),
        stats
      })
    );
  });

  server.listen(port, () => {
    logger.info(`Health server listening on :${port}`);
  });

  return server;
}
