import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("bottom reply keyboard exists", () => {
  assert.match(source, /createBottomKeyboard|ReplyKeyboard|keyboard/);
});

test("status explains ai calls separately from quota", () => {
  assert.match(source, /AI API 调用次数|AI API calls|aiCalls/);
});
