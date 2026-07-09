import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage } from '../src/utils/text.js';
import { normalizeLanguageCode, shouldRespondToMessage } from '../src/utils/telegram.js';

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

test('normalizeLanguageCode normalizes Telegram language codes', () => {
  assert.equal(normalizeLanguageCode('en-US'), 'en');
  assert.equal(normalizeLanguageCode('en_GB'), 'en');
  assert.equal(normalizeLanguageCode('zh-CN'), 'zh');
  assert.equal(normalizeLanguageCode('zh-Hans'), 'zh');
  assert.equal(normalizeLanguageCode('zh-TW'), 'zh-hant');
  assert.equal(normalizeLanguageCode('zh-HK'), 'zh-hant');

  assert.equal(normalizeLanguageCode('km'), 'km');
  assert.equal(normalizeLanguageCode('ms-MY'), 'ms');
  assert.equal(normalizeLanguageCode('ko-KR'), 'ko');
  assert.equal(normalizeLanguageCode('ja-JP'), 'ja');
  assert.equal(normalizeLanguageCode('th-TH'), 'th');
  assert.equal(normalizeLanguageCode('vi-VN'), 'vi');

  assert.equal(normalizeLanguageCode('', 'zh'), 'zh');
  assert.equal(normalizeLanguageCode('bad_language_code', 'en'), 'en');
});
