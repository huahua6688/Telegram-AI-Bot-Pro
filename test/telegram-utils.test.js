import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage } from '../src/utils/text.js';
import {
  createTelegramSessionId,
  decorateTelegramReplyText,
  getTelegramReplyContext,
  normalizeLanguageCode,
  resolveTelegramThreadId,
  shouldRespondToMessage
} from '../src/utils/telegram.js';

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

test('ordinary quoted replies stay in the main session while real topics stay isolated', () => {
  const ordinaryReply = {
    message_thread_id: 99,
    is_topic_message: false,
    quote: { text: '选中的新闻内容' },
    reply_to_message: { message_id: 10, text: '完整新闻摘要', from: { is_bot: true } }
  };
  const topicReply = { ...ordinaryReply, is_topic_message: true };

  assert.equal(resolveTelegramThreadId(ordinaryReply), 'main');
  assert.equal(resolveTelegramThreadId(topicReply), '99');
  assert.equal(createTelegramSessionId({ chat: { id: 1 }, from: { id: 2 }, message: ordinaryReply }), '1:2:main');
  assert.equal(createTelegramSessionId({ chat: { id: 1 }, from: { id: 2 }, message: topicReply }), '1:2:99');
});

test('selected Telegram quote is preserved as continuation context', () => {
  const message = {
    text: '这个具体是什么意思？',
    quote: { text: '央行宣布维持利率不变' },
    reply_to_message: { message_id: 20, text: '更长的整段新闻摘要', from: { is_bot: true } }
  };

  assert.deepEqual(getTelegramReplyContext(message), {
    text: '央行宣布维持利率不变',
    selected: true,
    messageId: 20,
    fromBot: true
  });

  const decorated = decorateTelegramReplyText(message.text, message);
  assert.match(decorated, /Selected quote/);
  assert.match(decorated, /央行宣布维持利率不变/);
  assert.match(decorated, /Continue the same conversation/);
  assert.match(decorated, /这个具体是什么意思/);
  assert.doesNotMatch(decorated, /更长的整段新闻摘要/);
});
