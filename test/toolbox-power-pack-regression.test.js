import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("main menu exposes toolbox", () => {
  assert.match(source, /buttonToolbox/);
  assert.match(source, /menu:toolbox/);
  assert.match(source, /toolbox_menu/);
});

test("toolbox keyboard and callback exist", () => {
  assert.match(source, /createToolboxKeyboard\(locale = 'zh'\)/);
  assert.match(source, /async handleToolboxCallback\(ctx\)/);
  assert.match(source, /toolbox:web/);
  assert.match(source, /toolbox:translate/);
  assert.match(source, /toolbox:image/);
  assert.match(source, /toolbox:voice/);
  assert.match(source, /toolbox:file/);
});

test("toolbox is registered as callback", () => {
  assert.match(source, /toolbox:\(\.\+\)/);
});
