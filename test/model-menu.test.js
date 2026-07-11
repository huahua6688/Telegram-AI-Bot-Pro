import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

test('model menu uses index callback data instead of raw model id', () => {
  assert.match(source, /`ai:m:\$\{index\}`/);
  assert.doesNotMatch(source, /`ai:m:\$\{model\}`/);
});
