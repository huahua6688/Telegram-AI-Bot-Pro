import http from 'node:http';

const port = Number(process.env.HEALTH_PORT || process.env.PORT || 8080);
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 3000);

const req = http.get(
  {
    host: '127.0.0.1',
    port,
    path: '/ready',
    timeout: timeoutMs
  },
  (res) => {
    const ok = res.statusCode >= 200 && res.statusCode < 300;

    if (!ok) {
      console.error(`Healthcheck failed with status ${res.statusCode}`);
    }

    res.resume();
    res.on('end', () => {
      process.exit(ok ? 0 : 1);
    });
  }
);

req.on('timeout', () => {
  req.destroy(new Error(`Healthcheck timed out after ${timeoutMs}ms`));
});

req.on('error', (error) => {
  console.error(`Healthcheck failed: ${error.message}`);
  process.exit(1);
});
