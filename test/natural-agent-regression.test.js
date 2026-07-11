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

test("natural tool answers use the user's selected AI settings", () => {
  assert.match(agent, /function getEffectiveAISettings/);
  assert.match(agent, /preferredProvider: providerId\(bot, ctx\)/);
  assert.match(agent, /fallbackEnabled: fallbackEnabled\(bot, ctx\)/);
  assert.match(bot, /composeToolReply/);
  assert.match(bot, /naturalAgentInternals\.composeHumanAnswer/);
});

test("current information requests route without requiring slash commands", () => {
  assert.match(agent, /extractWeatherLocation/);
  assert.match(agent, /looksLikeCurrentSearch/);
  assert.match(agent, /return runWeather\(bot, ctx, weatherLocation, text\)/);
  assert.match(agent, /return runSearch\(bot, ctx, normalizeSearchQuery\(text\) \|\| text, text\)/);
});
