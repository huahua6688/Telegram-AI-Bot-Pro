import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);

  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);

  return source.slice(start, end);
}

test('main menu uses inline buttons attached to the message', () => {
  const block = extractBetween('  createMenuKeyboard(locale) {', '\n\n  createModelKeyboard');

  assert.match(block, /Markup\.inlineKeyboard\(/);
  assert.doesNotMatch(block, /Markup\.keyboard\(/);
  assert.match(block, /menu:chat/);
  assert.match(block, /menu:translate/);
  assert.match(block, /menu:models/);
});

test('main menu callback handler is registered', () => {
  assert.match(source, /this\.bot\.action\(\/\^menu:\(\.\+\)\$\//);
  assert.match(source, /async handleMenuCallback\(ctx\)/);
  assert.match(source, /async handleMenuAction\(ctx, naturalAction/);
});
