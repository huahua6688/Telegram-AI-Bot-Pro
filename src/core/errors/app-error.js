import { ErrorCodes } from './error-codes.js';

export class AppError extends Error {
  constructor({ code = ErrorCodes.INTERNAL_ERROR, message, cause, details = {}, status = 500 }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
    this.details = details;
    this.status = status;
  }

  static wrap(error, fallback = {}) {
    if (error instanceof AppError) return error;
    return new AppError({
      code: fallback.code,
      message: fallback.message || error?.message || 'Unexpected application error',
      cause: error,
      details: fallback.details,
      status: fallback.status
    });
  }
}
