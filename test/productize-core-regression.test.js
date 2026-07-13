import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

function methodBody(name) {
  const markers = [`  ${name}(`, `  async ${name}(`];
  let start = -1;
  for (const marker of markers) {
    start = source.indexOf(marker);
    if (start !== -1) break;
  }
  assert.notEqual(start, -1, `missing ${name}`);

  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error(`cannot extract ${name}`);
}

test("assistant action keyboard hides incomplete favorite button", () => {
  const body = methodBody("createAssistantActionKeyboard");
  assert.ok(!body.includes("act:favorite"), "favorite button should be hidden until list/export is complete");
  assert.match(body, /act:regen/);
  assert.match(body, /act:translate/);
  assert.match(body, /act:clear/);
});

test("assistant model action opens the real AI provider settings", () => {
  const body = methodBody("handleAssistantActionCallback");
  assert.match(body, /action === 'model'/);
  assert.match(body, /this\.getEffectiveAISettings\(state\.userId\)/);
  assert.match(body, /this\.formatAISettingsPanel\(settings, state\.locale\)/);
  assert.match(body, /this\.createAIProviderKeyboard\(settings, state\.locale\)/);
});

test("main chat refunds only when the assistant reply was not delivered", () => {
  const body = methodBody("handleIncomingMessage");
  assert.match(body, /let assistantDelivered = false/);
  assert.match(body, /assistantDelivered = true/);
  assert.match(body, /if \(!assistantDelivered\) await this\.refundQuotaForContext\(ctx\)/);
});

test("translation mode is persistent until exit", () => {
  assert.match(source, /this\.activeModes = new Map\(\)/);
  assert.match(source, /async handleActiveMode\(ctx, mode\)/);
  assert.match(source, /type:\s*'translate'/);
  assert.match(source, /mode:clear/);
  assert.match(source, /Every text message will be translated|每一句文字都会自动翻译/);
});

test("persona overview explains what persona means", () => {
  assert.match(source, /formatPersonaOverview\(currentPersona/);
  assert.match(source, /系统提示词|system prompt/);
  assert.match(source, /程序员|Coding/);
});
