import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

test('provider callback validates provider id against allowlist', () => {
  assert.match(source, /AI_PROVIDER_MENU_ORDER\.includes\(providerId\)/);
  assert.match(source, /Unsupported provider/);
});
