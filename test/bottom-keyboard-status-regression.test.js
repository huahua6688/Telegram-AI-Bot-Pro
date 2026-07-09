import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("bottom keyboard and status code are present", () => {
  assert.match(source, /createBottomKeyboard|createMenuKeyboard/);
  assert.match(source, /handleStatus/);
});
