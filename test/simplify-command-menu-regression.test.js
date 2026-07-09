import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

function extractMethod(signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);

  const open = source.indexOf("{", start);
  assert.ok(open >= 0, `missing method body for ${signature}`);

  let depth = 0;
  let quote = null;
  let escape = false;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
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

  throw new Error(`unterminated method ${signature}`);
}

test("Telegram slash command menu is registered through localized command helper", () => {
  const init = extractMethod("async init()");
  const localized = extractMethod("async setLocalizedBotCommands()");

  assert.ok(
    init.includes("await this.setLocalizedBotCommands();"),
    "init should call setLocalizedBotCommands"
  );

  assert.ok(
    localized.includes("setMyCommands"),
    "localized command helper should call setMyCommands"
  );

  assert.ok(
    localized.includes("language_code"),
    "localized command helper should register language-specific commands"
  );
});

test("Telegram slash command menu only exposes button-first essentials", () => {
  const localized = extractMethod("async setLocalizedBotCommands()");

  assert.match(localized, /command:\s*['"]start['"]/);
  assert.match(localized, /command:\s*['"]menu['"]/);
  assert.match(localized, /command:\s*['"]whoami['"]/);
  assert.match(localized, /command:\s*['"]status['"]/);

  assert.doesNotMatch(localized, /command:\s*['"]models['"]/);
  assert.doesNotMatch(localized, /command:\s*['"]memory['"]/);
  assert.doesNotMatch(localized, /command:\s*['"]translate['"]/);
  assert.doesNotMatch(localized, /command:\s*['"]tr['"]/);
  assert.doesNotMatch(localized, /command:\s*['"]reset['"]/);
  assert.doesNotMatch(localized, /command:\s*['"]clear['"]/);
});

test("internal command handlers can still exist without showing in slash menu", () => {
  const register = extractMethod("registerCommands()");

  assert.match(register, /this\.bot\.command\('models'/);
  assert.match(register, /this\.bot\.command\('translate'/);
  assert.match(register, /this\.bot\.command\('help'/);
});
