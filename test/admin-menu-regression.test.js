import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

test('main menu exposes admin button', () => {
  assert.match(source, /buttonAdmin/);
  assert.match(source, /menu:admin/);
  assert.match(source, /admin_menu/);
});

test('admin panel exposes status whoami models quota and docs callbacks', () => {
  assert.match(source, /createAdminActionKeyboard\(locale = 'zh'\)/);
  assert.match(source, /admin_pick:status/);
  assert.match(source, /admin_pick:whoami/);
  assert.match(source, /admin_pick:models/);
  assert.match(source, /admin_pick:quota/);
  assert.match(source, /admin_pick:docs/);
});

test('admin panel exposes dynamic provider model synchronization', () => {
  assert.match(source, /admin_pick:model_sync/);
  assert.match(source, /handleAdminModelSync/);
  assert.match(source, /refreshModels\('openai-compatible'/);
});

test('admin callback is registered and handled', () => {
  assert.match(source, /this\.bot\.action\(\/\^admin_pick:\(\.\+\)\$\//);
  assert.match(source, /async handleAdminActionCallback\(ctx\)/);
  assert.match(source, /async handleAdminQuota\(ctx\)/);
});
