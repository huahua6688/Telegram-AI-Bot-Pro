import { createApplication } from './application.js';
import { AppError } from '../core/errors/app-error.js';
import { ErrorCodes } from '../core/errors/error-codes.js';
import { withRequestContext } from '../core/observability/request-context.js';

export async function bootstrap() {
  const app = await createApplication();
  await app.start();

  const shutdown = async (signal) => {
    await withRequestContext({ requestId: signal }, async () => {
      try {
        app.logger.info(`Received ${signal}`);
        await app.stop(signal);
        process.exit(0);
      } catch (error) {
        const wrapped = AppError.wrap(error, {
          code: ErrorCodes.SHUTDOWN_FAILED,
          message: 'Graceful shutdown failed.'
        });
        app.logger.error(wrapped.message, {
          code: wrapped.code,
          details: wrapped.details,
          cause: wrapped.cause
        });
        process.exit(1);
      }
    });
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  return app;
}
