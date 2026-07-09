import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const agent = fs.readFileSync("src/services/natural-agent.js", "utf8");

test("natural agent stores handled interactions into conversation", () => {
  assert.match(agent, /rememberHandledInteraction/);
  assert.match(agent, /bot\.db\.setConversation/);
  assert.match(agent, /bot\.db\.getConversation/);
});

test("follow-up only messages fall back to normal chat with context", () => {
  assert.match(agent, /isFollowUpOnly/);
  assert.match(agent, /还有吗/);
  assert.match(agent, /return false/);
});

test("bare urls are stripped from answer body and references stay clickable", () => {
  assert.match(agent, /stripBareUrls/);
  assert.match(agent, /stripGeneratedReferences/);
  assert.match(agent, /<a href=/);
  assert.match(agent, /parse_mode: 'HTML'/);
});
