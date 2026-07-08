import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("bottom reply keyboard exists for persistent shortcuts", () => {
  assert.match(source, /createBottomKeyboard\(locale = 'zh'\)/);
  assert.match(source, /reply_markup/);
  assert.match(source, /keyboard:\s*rows/);
  assert.match(source, /resize_keyboard:\s*true/);
  assert.match(source, /is_persistent:\s*true/);
  assert.match(source, /退出模式|Exit mode/);
});

test("incoming messages handle bottom keyboard before active mode", () => {
  const bottomIndex = source.indexOf("await this.handleBottomKeyboardAction(ctx)");
  const activeIndex = source.indexOf("const activeMode = this.getActiveMode(ctx)");

  assert.ok(bottomIndex > 0, "bottom keyboard handler missing");

  if (activeIndex > 0) {
    assert.ok(activeIndex > bottomIndex, "bottom keyboard must be handled before active mode");
  }
});

test("status explains ai calls separately from quota", () => {
  assert.match(source, /当前用户额度|Current user quota/);
  assert.match(source, /全局运行统计|Global runtime stats/);
  assert.match(source, /AI API 调用次数|AI API calls/);
  assert.match(source, /不等于今日额度|not the same as your daily quota/);
});
