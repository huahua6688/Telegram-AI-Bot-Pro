import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const agent = fs.readFileSync("src/services/natural-agent.js", "utf8");
const bot = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("natural agent and minimal keyboard are present", () => {
  assert.match(agent, /tryHandleNaturalAgent/);
  assert.match(agent, /composeHumanAnswer/);
  assert.match(bot, /createBottomKeyboard/);
});
