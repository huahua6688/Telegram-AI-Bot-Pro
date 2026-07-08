import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("main menu has close button", () => {
  assert.match(source, /menu:close/);
  assert.match(source, /关闭菜单|Close menu/);
});

test("menu callback can delete current menu message", () => {
  assert.match(source, /target === 'close'/);
  assert.match(source, /ctx\.deleteMessage\(\)/);
});

test("admin panel has quick guide", () => {
  assert.match(source, /admin_pick:quick_help/);
  assert.match(source, /async handleAdminQuickHelp\(ctx\)/);
  assert.match(source, /管理员快捷说明|Admin quick guide/);
});
