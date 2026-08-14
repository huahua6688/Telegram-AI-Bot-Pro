import test from 'node:test';
import assert from 'node:assert/strict';

import { createApplicationLifecycle } from '../src/app/application-lifecycle.js';

function callbackServer(name, calls) {
  return {
    close(callback) {
      calls.push(`${name}:close`);
      callback();
    }
  };
}

test('startup failure closes bots, HTTP servers, and database exactly once', async () => {
  const calls = [];
  const startupError = new Error('SUPPORT_LAUNCH_FAILED');
  const lifecycle = createApplicationLifecycle({
    bot: {
      async launch() { calls.push('bot:launch'); },
      async stop(signal) { calls.push(`bot:stop:${signal}`); }
    },
    supportBot: {
      async launch() {
        calls.push('support:launch');
        throw startupError;
      },
      async stop(signal) { calls.push(`support:stop:${signal}`); }
    },
    healthServer: callbackServer('health', calls),
    adminServer: callbackServer('admin', calls),
    db: { close() { calls.push('db:close'); } },
    logger: { error() {} }
  });

  await assert.rejects(lifecycle.start(), (error) => error === startupError);
  assert.deepEqual(calls, [
    'bot:launch',
    'support:launch',
    'bot:stop:STARTUP_FAILED',
    'support:stop:STARTUP_FAILED',
    'health:close',
    'admin:close',
    'db:close'
  ]);

  await lifecycle.stop('SECOND_STOP');
  assert.equal(calls.filter((call) => call.endsWith(':close')).length, 3);
});

test('shutdown attempts every resource even when a bot stop fails', async () => {
  const calls = [];
  const stopError = new Error('BOT_STOP_FAILED');
  const lifecycle = createApplicationLifecycle({
    bot: {
      async stop() {
        calls.push('bot:stop');
        throw stopError;
      }
    },
    supportBot: { async stop() { calls.push('support:stop'); } },
    healthServer: callbackServer('health', calls),
    adminServer: callbackServer('admin', calls),
    db: { close() { calls.push('db:close'); } },
    logger: { error() {} }
  });

  await assert.rejects(lifecycle.stop('SIGTERM'), (error) => error === stopError);
  assert.deepEqual(calls, [
    'bot:stop',
    'support:stop',
    'health:close',
    'admin:close',
    'db:close'
  ]);
});


test('pending long polling does not block support bot startup', async () => {
  const calls = [];
  const pendingPolling = new Promise(() => {});

  const lifecycle = createApplicationLifecycle({
    bot: {
      launch(onLaunch) {
        calls.push('bot:launch');
        onLaunch();
        return pendingPolling;
      },
      async stop() {}
    },
    supportBot: {
      launch(onLaunch) {
        calls.push('support:launch');
        onLaunch();
        return pendingPolling;
      },
      async stop() {}
    },
    logger: {
      error() {}
    }
  });

  await lifecycle.start();

  assert.deepEqual(calls, [
    'bot:launch',
    'support:launch'
  ]);
});

test('primary readiness is reported even while an optional support launch remains pending', async () => {
  let ready = false;
  const pendingSupport = new Promise(() => {});
  const lifecycle = createApplicationLifecycle({
    bot: {
      launch(onLaunch) {
        onLaunch();
        return new Promise(() => {});
      },
      async stop() {}
    },
    supportBot: {
      launch() {
        return pendingSupport;
      },
      async stop() {}
    },
    onPrimaryReady() {
      ready = true;
    },
    logger: { error() {}, warn() {} }
  });

  lifecycle.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ready, true);
});
