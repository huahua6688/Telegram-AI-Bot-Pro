import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const storage = new AsyncLocalStorage();

export function withRequestContext(context = {}, callback) {
  const requestId = context.requestId || crypto.randomUUID();
  return storage.run({ ...context, requestId }, callback);
}

export function getRequestContext() {
  return storage.getStore() || { requestId: 'system' };
}
