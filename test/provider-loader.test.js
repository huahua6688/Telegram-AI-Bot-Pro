import test from 'node:test';
import assert from 'node:assert/strict';
import { defineCapabilityMatrix } from '../src/core/providers/capability-matrix.js';
import { createProviderContract } from '../src/core/providers/provider-contract.js';
import { createProviderLoader } from '../src/core/providers/provider-loader.js';

test('defineCapabilityMatrix normalizes known capabilities', () => {
  const matrix = defineCapabilityMatrix({ chat: true, toolCalls: 1, unknown: true });
  assert.equal(matrix.chat, true);
  assert.equal(matrix.toolCalls, true);
  assert.equal(matrix.imageGeneration, false);
  assert.equal(Object.hasOwn(matrix, 'unknown'), false);
});

test('createProviderContract validates required fields', () => {
  assert.throws(() => createProviderContract({}), /requires an id/);
  assert.throws(() => createProviderContract({ id: 'demo' }), /requires createClient/);
});

test('provider loader creates client and applies capability contract', () => {
  const loader = createProviderLoader();

  loader.loadPlugins([
    () => ({
      id: 'demo',
      capabilities: { chat: true, liveTranslate: true },
      createClient: () => ({
        getProviderName: () => 'demo',
        getCapabilities: () => ({ chat: true })
      })
    })
  ]);

  const client = loader.createClient({ aiProvider: 'demo' }, {});
  assert.equal(client.getProviderName(), 'demo');
  const capabilities = client.getCapabilities();
  assert.equal(capabilities.chat, true);
  assert.equal(capabilities.liveTranslate, true);
  assert.equal(capabilities.imageGeneration, false);
});
