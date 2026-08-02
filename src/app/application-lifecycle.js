function closeHttpServer(server) {
  if (!server || typeof server.close !== 'function') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const finish = (error) => {
      if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') {
        resolve();
        return;
      }
      reject(error);
    };

    try {
      server.close(finish);
    } catch (error) {
      finish(error);
    }
  });
}

export async function stopApplicationResources(
  { bot, supportBot, healthServer, adminServer, db, logger },
  signal
) {
  const failures = [];
  const runPhase = async (entries) => {
    const results = await Promise.allSettled(
      entries.map(([, action]) => Promise.resolve().then(action))
    );
    results.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      const [resource] = entries[index];
      failures.push({ resource, error: result.reason });
      logger?.error?.('Application resource shutdown failed', {
        resource,
        signal,
        error: result.reason?.message || String(result.reason)
      });
    });
  };

  await runPhase([
    ['telegram-bot', () => bot?.stop?.(signal)],
    ['support-bot', () => supportBot?.stop?.(signal)]
  ]);
  await runPhase([
    ['health-server', () => closeHttpServer(healthServer)],
    ['admin-server', () => closeHttpServer(adminServer)]
  ]);
  await runPhase([
    ['database', () => db?.close?.()]
  ]);

  if (failures.length > 0) throw failures[0].error;
}

export function createApplicationLifecycle(resources) {
  let stopPromise = null;

  const stop = (signal) => {
    if (!stopPromise) {
      stopPromise = stopApplicationResources(resources, signal);
    }
    return stopPromise;
  };

  return {
    async start() {
      try {
        await resources.bot?.launch?.();
        await resources.supportBot?.launch?.();
      } catch (error) {
        try {
          await stop('STARTUP_FAILED');
        } catch (cleanupError) {
          resources.logger?.error?.('Startup cleanup failed', {
            error: cleanupError?.message || String(cleanupError)
          });
        }
        throw error;
      }
    },
    stop
  };
}
