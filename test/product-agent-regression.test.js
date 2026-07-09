import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const botSource = fs.readFileSync("src/services/telegram-bot.js", "utf8");
const agentSource = fs.readFileSync("src/services/product-agent.js", "utf8");

test("product agent is wired before normal translation and AI chat", () => {
  assert.match(botSource, /tryHandleProductAgentRoute/);
  const agentIndex = botSource.indexOf("tryHandleProductAgentRoute(this, ctx)");
  const translationIndex = botSource.indexOf("parseTranslationRequest(text)");
  assert.ok(agentIndex > 0);
  assert.ok(translationIndex > agentIndex);
});

test("product agent handles search url news weather and translation", () => {
  assert.match(agentSource, /runSmartSearch/);
  assert.match(agentSource, /runSmartUrlFetch/);
  assert.match(agentSource, /runSmartWeather/);
  assert.match(agentSource, /fetchNewsFallback/);
  assert.match(agentSource, /trailingTranslateRegex/);
  assert.match(agentSource, /translateModeRegex/);
});

test("product agent does not expose empty json results", () => {
  assert.match(agentSource, /hasUsefulToolResult/);
  assert.match(agentSource, /没有搜到有效结果/);
  assert.match(agentSource, /BRAVE_SEARCH_API_KEY/);
});
