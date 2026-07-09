import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const agent = fs.readFileSync("src/services/natural-agent.js", "utf8");
const bot = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("references are clickable descriptive links", () => {
  assert.match(agent, /parse_mode: 'HTML'/);
  assert.match(agent, /<a href=/);
  assert.match(agent, /extractReferenceLinks/);
  assert.match(agent, /appendClickableReferences/);
});

test("composer uses context and does not dump raw tool output", () => {
  assert.match(agent, /getRecentContext/);
  assert.match(agent, /Recent conversation context|Recent context/);
  assert.match(agent, /Do not dump JSON/);
  assert.match(agent, /Do not dump raw original titles and links/);
});

test("natural agent is wired and bottom keyboard is minimal", () => {
  assert.match(bot, /tryHandleNaturalAgent/);
  assert.match(bot, /🆘 帮助/);
  assert.match(bot, /⚙️ 设置/);
  assert.match(bot, /🛠 管理/);
  assert.match(bot, /❌ 退出模式/);
});
