import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const bot = fs.readFileSync("src/services/telegram-bot.js", "utf8");
const agent = fs.readFileSync("src/services/natural-agent.js", "utf8");

function methodSlice(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const end = nextSignature ? source.indexOf(nextSignature, start + signature.length) : -1;
  return end > start ? source.slice(start, end) : source.slice(start);
}

test("normal messages use the main single-pass agent", () => {
  assert.match(bot, /tryHandleNaturalAgent/);
  assert.doesNotMatch(bot, /tryHandleProductAgentRoute/);
  const handler = methodSlice(agent, "export async function tryHandleNaturalAgent", "export const naturalAgentInternals");
  assert.doesNotMatch(handler, /await classifyNaturally/);
  assert.match(bot, /const routedIntent = null/);
});

test("visible main menu is minimal", () => {
  const menu = methodSlice(bot, "createMenuKeyboard", "createSettingsKeyboard");
  assert.match(menu, /menu:help/);
  assert.match(menu, /menu:settings/);
  assert.match(menu, /menu:admin/);
  assert.match(menu, /menu:close/);

  assert.doesNotMatch(menu, /menu:chat/);
  assert.doesNotMatch(menu, /menu:translate/);
  assert.doesNotMatch(menu, /menu:file/);
  assert.doesNotMatch(menu, /menu:web/);
  assert.doesNotMatch(menu, /menu:image/);
  assert.doesNotMatch(menu, /menu:tts/);
  assert.doesNotMatch(menu, /menu:toolbox/);
});

test("visible settings menu has no toolbox entry", () => {
  const settings = methodSlice(bot, "createSettingsKeyboard", "createToolboxKeyboard");
  assert.doesNotMatch(settings, /settings_pick:toolbox/);
  assert.doesNotMatch(settings, /toolbox:/);
});

test("bottom assistant buttons remain minimal", () => {
  assert.match(bot, /menu:help/);
  assert.match(bot, /menu:settings/);
  assert.match(bot, /menu:admin/);
  assert.match(bot, /menu:close/);
});
