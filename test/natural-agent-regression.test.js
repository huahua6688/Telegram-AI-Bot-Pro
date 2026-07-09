import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const botSource = fs.readFileSync("src/services/telegram-bot.js", "utf8");
const agentSource = fs.readFileSync("src/services/natural-agent.js", "utf8");

test("natural agent is wired before old parsing", () => {
  assert.match(botSource, /tryHandleNaturalAgent/);
  const agentIndex = botSource.indexOf("tryHandleNaturalAgent(this, ctx)");
  const translationIndex = botSource.indexOf("parseTranslationRequest(text)");
  assert.ok(agentIndex > 0);
  assert.ok(translationIndex > agentIndex);
});

test("natural agent can classify without user commands", () => {
  assert.match(agentSource, /classifyNaturally/);
  assert.match(agentSource, /The user must not need commands/);
  assert.match(agentSource, /web_search/);
  assert.match(agentSource, /weather/);
  assert.match(agentSource, /translate/);
  assert.match(agentSource, /fetch_url/);
});

test("natural agent formats tool results instead of dumping empty JSON", () => {
  assert.match(agentSource, /hasUsefulToolResult/);
  assert.match(agentSource, /没有拿到有效结果|没有搜到有效结果/);
  assert.match(agentSource, /formatToolResult/);
});
