import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("cleans markdown-looking AI output globally", () => {
  assert.match(source, /function cleanBotOutput/);
  assert.match(source, /global_plain_text_reply_cleaner/);
  assert.match(source, /Do not expose internal tool names/);
});

test("hard routes common tools before normal AI chat", () => {
  assert.match(source, /directUrl/);
  assert.match(source, /runUrlFetch\(ctx, directUrl\)/);
  assert.match(source, /directSearch/);
  assert.match(source, /runWebSearch\(ctx, directSearch/);
  assert.match(source, /directWeather/);
  assert.match(source, /runWeather\(ctx, directWeather/);
});

test("help request does not fall through to AI self description", () => {
  assert.match(source, /你能做什么/);
  assert.match(source, /handleHelp\(ctx\)/);
});
