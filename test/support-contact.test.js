import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendSupportInlineKeyboardRow,
  createSupportButtonData,
  mergeInlineKeyboardRows,
  normalizeSupportBotUsername,
  normalizeSupportContactUrl,
  resolveSupportContactUrl
} from '../src/services/support-contact.js';

test('custom HTTPS support URL has priority over the Telegram username', () => {
  const config = {
    supportEnabled: true,
    supportContactUrl: 'https://support.example/help?source=bot',
    supportBotUsername: '@FallbackSupportBot'
  };

  assert.equal(resolveSupportContactUrl(config), 'https://support.example/help?source=bot');
  assert.deepEqual(createSupportButtonData(config, { locale: 'zh' }), {
    text: '联系人工客服',
    url: 'https://support.example/help?source=bot'
  });
});

test('a safe Telegram support username creates a start=support deep link', () => {
  assert.equal(normalizeSupportBotUsername('@XiomnSupportBot'), 'XiomnSupportBot');
  assert.equal(resolveSupportContactUrl({
    supportEnabled: true,
    supportBotUsername: '@XiomnSupportBot'
  }), 'https://t.me/XiomnSupportBot?start=support');
  assert.equal(
    createSupportButtonData({ supportEnabled: true, supportBotUsername: 'XiomnSupportBot' }, { locale: 'en-US' }).text,
    'Contact support'
  );
});

test('disabled or unsafe support configuration does not create button data', () => {
  assert.equal(createSupportButtonData({
    supportEnabled: false,
    supportBotUsername: 'ValidSupportBot'
  }), null);
  assert.equal(createSupportButtonData({
    supportEnabled: true,
    supportContactUrl: 'javascript:alert(1)',
    supportBotUsername: 'ValidSupportBot'
  }), null, 'an explicitly invalid custom URL must not silently fall back');
  assert.equal(createSupportButtonData({
    supportEnabled: true,
    supportContactUrl: 'https://user:password@support.example/help'
  }), null);
  assert.equal(createSupportButtonData({
    supportEnabled: true,
    supportBotUsername: 'bad-name'
  }), null);
  assert.equal(normalizeSupportContactUrl('http://support.example/help'), '');
  assert.equal(normalizeSupportContactUrl('https://support.example/\u0000bad'), '');
});

test('inline keyboard row merging is pure and appends a support row only when valid', () => {
  const existing = [[{ text: 'Balance', callback_data: 'billing:balance' }]];
  const appended = [[{ text: 'Terms', callback_data: 'billing:terms' }]];
  const snapshot = structuredClone(existing);

  const merged = mergeInlineKeyboardRows(existing, appended);
  merged[0][0].text = 'Changed';

  assert.deepEqual(existing, snapshot);
  assert.deepEqual(merged[1], appended[0]);

  const withSupport = appendSupportInlineKeyboardRow(existing, {
    supportEnabled: true,
    supportBotUsername: 'XiomnSupportBot'
  }, { locale: 'zh', text: 'Bot 故障？联系客服' });
  assert.deepEqual(withSupport, [
    [{ text: 'Balance', callback_data: 'billing:balance' }],
    [{ text: 'Bot 故障？联系客服', url: 'https://t.me/XiomnSupportBot?start=support' }]
  ]);

  const appendedAgain = appendSupportInlineKeyboardRow(withSupport, {
    supportEnabled: true,
    supportBotUsername: 'XiomnSupportBot'
  }, { locale: 'en' });
  assert.equal(
    appendedAgain.flat().filter((button) => button.url === 'https://t.me/XiomnSupportBot?start=support').length,
    1,
    'adding support repeatedly must not duplicate the same contact URL'
  );
  assert.notEqual(appendedAgain, withSupport);

  const withoutSupport = appendSupportInlineKeyboardRow(existing, {
    supportEnabled: false,
    supportBotUsername: 'XiomnSupportBot'
  });
  assert.deepEqual(withoutSupport, existing);
  assert.notEqual(withoutSupport, existing);
  assert.notEqual(withoutSupport[0], existing[0]);
});
