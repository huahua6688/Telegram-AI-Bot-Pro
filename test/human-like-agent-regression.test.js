import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const agent = fs.readFileSync("src/services/natural-agent.js", "utf8");
const bot = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("search results are composed into human answer", () => {
  assert.match(agent, /composeHumanAnswer/);
  assert.match(agent, /Do not dump JSON/);
  assert.match(agent, /Do not dump raw original titles and links/);
  assert.match(agent, /参考链接/);
});

test("strict translation parsing runs before broad news and search routing", () => {
  assert.match(bot, /tryHandleNaturalAgent/);
  const agentIndex = bot.indexOf("tryHandleNaturalAgent(this, ctx)");
  const translationIndex = bot.indexOf("parseTranslationRequest(text)");
  assert.ok(agentIndex > 0);
  assert.ok(translationIndex > 0);
  assert.ok(translationIndex < agentIndex);
});

test("bottom keyboard is minimal", () => {
  assert.match(bot, /🆘 帮助/);
  assert.match(bot, /⚙️ 设置/);
  assert.match(bot, /🛠 管理/);
  assert.match(bot, /❌ 退出模式/);
  assert.doesNotMatch(bot, /🧰 工具箱', '🌍 翻译', '🌤 天气/);
});
