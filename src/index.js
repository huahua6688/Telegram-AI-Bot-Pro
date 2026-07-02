import { bootstrap } from './app/bootstrap.js';
import { AppError } from './core/errors/app-error.js';
import { ErrorCodes } from './core/errors/error-codes.js';
import { logger } from './logger.js';
import { withRequestContext } from './core/observability/request-context.js';

withRequestContext({ requestId: 'startup' }, async () => {
  try {
    await bootstrap();
  } catch (error) {
    const wrapped = AppError.wrap(error, {
      code: ErrorCodes.STARTUP_FAILED,
      message: 'Fatal startup error'
    });
    logger.error(wrapped.message, {
      code: wrapped.code,
      details: wrapped.details,
      cause: wrapped.cause
    });
    process.exit(1);
  }
});
