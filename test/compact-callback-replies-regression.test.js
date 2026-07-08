import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("compact callback reply helper exists", () => {
  assert.ok(source.includes("async withCompactCallbackReply(ctx, handler)"));
  assert.ok(source.includes("ctx.reply = async (text, extra = {})"));
  assert.ok(source.includes("ctx.editMessageText(editableText, editExtra)"));
});

test("button callback handlers are wrapped", () => {
  const required = [
    "this.bot.action(/^memory_pick:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^clear_pick:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^translate_pick:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^file_pick:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^voice_pick:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^image_pick:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^set_model:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^set_persona:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^set_language:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^menu:(.+)$/, (ctx) => this.withCompactCallbackReply",
    "this.bot.action(/^admin_pick:(.+)$/, (ctx) => this.withCompactCallbackReply"
  ];

  for (const item of required) {
    assert.ok(source.includes(item), `missing compact wrapper: ${item}`);
  }
});
