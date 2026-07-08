import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("main menu and toolbox expose settings center", () => {
  assert.match(source, /menu:settings/);
  assert.match(source, /settings_pick:overview/);
  assert.match(source, /设置中心|Settings/);
});

test("settings center keyboard exists", () => {
  assert.match(source, /createSettingsKeyboard\(locale = 'zh'\)/);
  assert.match(source, /settings_pick:model/);
  assert.match(source, /settings_pick:persona/);
  assert.match(source, /settings_pick:language/);
  assert.match(source, /settings_pick:memory/);
  assert.match(source, /settings_pick:clear/);
});

test("settings callback is registered and handled", () => {
  assert.match(source, /settings_pick:\(\.\+\)/);
  assert.match(source, /async handleSettingsOverview\(ctx\)/);
  assert.match(source, /async handleSettingsCallback\(ctx\)/);
  assert.match(source, /type === 'settings_menu'/);
});
