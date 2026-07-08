import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("admin panel exposes AI test button", () => {
  assert.match(source, /admin_pick:ai_test/);
  assert.match(source, /AI 测试|AI test/);
});

test("admin AI test calls current AI model", () => {
  assert.match(source, /async handleAdminAiTest\(ctx\)/);
  assert.match(source, /completeWithAiFallback/);
  assert.match(source, /AI_OK/);
});

test("admin callback handles AI test action", () => {
  assert.match(source, /target === .ai_test./);
  assert.match(source, /handleAdminAiTest\(ctx\)/);
});
