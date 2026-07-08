import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("submenus expose back to main menu button", () => {
  assert.match(source, /menu:back/);
  assert.match(source, /返回主菜单|Main menu/);
});

test("menu back action returns to main menu", () => {
  assert.match(source, /main_menu/);
  assert.match(source, /async handleMenuAction\(ctx,\s*naturalAction\)/);
  assert.match(source, /type === ['"]main_menu['"]/);
  assert.match(source, /handleMenu\(ctx\)/);
});
