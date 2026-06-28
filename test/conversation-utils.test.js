import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConversationHistory, sanitizeConversationMessages } from '../src/utils/conversation.js';

test('sanitizeConversationMessages removes orphan tool responses', () => {
  const messages = sanitizeConversationMessages([
    { role: 'assistant', content: 'hello' },
    { role: 'tool', tool_call_id: 'missing', content: '{}' },
    { role: 'user', content: 'next' }
  ]);

  assert.deepEqual(messages, [
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'next' }
  ]);
});

test('buildConversationHistory drops incomplete trailing tool bundles', () => {
  const history = buildConversationHistory(
    [
      { role: 'user', content: 'question' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{}' } }]
      }
    ],
    4
  );

  assert.deepEqual(history, [{ role: 'user', content: 'question' }]);
});

test('buildConversationHistory preserves complete tool bundles', () => {
  const history = buildConversationHistory(
    [
      { role: 'user', content: 'question' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' },
      { role: 'assistant', content: 'answer' }
    ],
    4
  );

  assert.equal(history.length, 4);
  assert.equal(history[1].role, 'assistant');
  assert.equal(history[2].role, 'tool');
  assert.equal(history[3].content, 'answer');
});
