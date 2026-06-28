import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage } from '../src/utils/text.js';
import { shouldRespondToMessage } from '../src/utils/telegram.js';

test('splitMessage preserves content in chunks', () => {
  const message = 'hello '.repeat(800);
  const chunks = splitMessage(message, 1000);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), message.replace(/\s+/g, ' ').trim());
});

test('shouldRespondToMessage always responds in private chats', () => {
  assert.equal(
    shouldRespondToMessage({
      chatType: 'private',
      text: 'hello'
    }),
    true
  );
});

test('shouldRespondToMessage supports smart group triggers', () => {
  assert.equal(
    shouldRespondToMessage({
      chatType: 'group',
      text: 'hello @mybot',
      botUsername: 'mybot',
      triggerMode: 'smart',
      keyword: 'ai'
    }),
    true
  );

  assert.equal(
    shouldRespondToMessage({
      chatType: 'group',
      text: 'just chatting',
      botUsername: 'mybot',
      triggerMode: 'smart',
      keyword: 'ai'
    }),
    false
  );
});
