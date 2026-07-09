import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const bot = fs.readFileSync("src/services/telegram-bot.js", "utf8");
const agent = fs.readFileSync("src/services/natural-agent.js", "utf8");
const utils = fs.readFileSync("src/utils/telegram.js", "utf8");

test("telegram language codes are not limited to zh/en", () => {
  assert.ok(utils.includes("raw.startsWith('en')"), "en language normalization should exist");
  assert.ok(utils.includes("raw.startsWith('zh')"), "zh language normalization should exist");
  assert.ok(utils.includes("zh-hant"), "traditional Chinese should be supported");

  assert.ok(bot.includes("Auto / Telegram"), "language keyboard should include auto mode");
  assert.ok(bot.includes("ភាសាខ្មែរ"), "Khmer should be listed");
  assert.ok(bot.includes("Bahasa Melayu"), "Malay should be listed");
  assert.ok(bot.includes("한국어"), "Korean should be listed");
  assert.ok(bot.includes("ไทย"), "Thai should be listed");
});

test("ui labels use current locale and commands are localized", () => {
  assert.ok(bot.includes("function uiLabel"), "uiLabel helper should exist");
  assert.ok(
    bot.includes("this.ui(locale, 'help')") || bot.includes('this.ui(locale, "help")'),
    "visible buttons should use localized ui labels"
  );
  assert.ok(bot.includes("setLocalizedBotCommands"), "localized slash command helper should exist");
  assert.ok(bot.includes("language_code"), "slash commands should support language_code");
});

test("persona affects natural-agent answers and followups", () => {
  assert.ok(agent.includes("personaPresets"), "natural-agent should import personaPresets");
  assert.ok(agent.includes("getPersonaInstruction"), "natural-agent should read persona instruction");
  assert.ok(agent.includes("Persona:"), "persona prompt should be injected");
  assert.ok(agent.includes("followupPersonaInstruction"), "follow-up should also use persona");
});

test("follow-up context remains enabled", () => {
  assert.ok(agent.includes("continueFromContext"), "continueFromContext should exist");
  assert.ok(agent.includes("Do not start a new topic"), "follow-up should not start a new topic");
  assert.ok(agent.includes("rememberHandledInteraction"), "natural-agent should remember handled interactions");
});
