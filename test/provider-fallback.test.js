import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProviderError } from '../src/services/ai-provider-manager.js';

test('provider fallback classifies transient and quota failures', () => {
  assert.equal(classifyProviderError(new Error('AI request failed (429): quota')), 'quota');
  assert.equal(classifyProviderError(new Error('AI request failed (503): overloaded')), 'transient');
  assert.equal(classifyProviderError(new Error('AI provider returned an empty response.')), 'empty');
});
