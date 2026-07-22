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
  const perChat = extractMethod("async setChatBotCommands(ctx, locale = 'en')");

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

  assert.ok(
    perChat.includes("scope: { type: 'chat', chat_id: chatId }"),
    "selected bot language should refresh the current chat command menu"
  );
});

test("Telegram slash command menu exposes user-facing essentials", () => {
  const start = source.indexOf("const BOT_COMMAND_NAMES = [");
  const end = source.indexOf("const BOT_COMMAND_DESCRIPTIONS", start);
  const commands = source.slice(start, end);

  for (const command of ['start', 'menu', 'help', 'reset', 'whoami']) {
    assert.match(commands, new RegExp(`['"]${command}['"]`));
  }

  assert.doesNotMatch(commands, /['"]web['"]/);
  assert.doesNotMatch(commands, /['"]models['"]/);
  assert.doesNotMatch(commands, /['"]persona['"]/);
  assert.doesNotMatch(commands, /['"]language['"]/);
  assert.doesNotMatch(commands, /['"]status['"]/);
  assert.doesNotMatch(commands, /['"]memory['"]/);
  assert.doesNotMatch(commands, /['"]translate['"]/);
  assert.doesNotMatch(commands, /['"]clear['"]/);
});

test("internal command handlers can still exist without showing in slash menu", () => {
  // Match the method declaration, not the earlier invocation inside init().
  const register = extractMethod("registerCommands() {");

  assert.match(register, /this\.bot\.command\('models'/);
  assert.match(register, /this\.bot\.command\('web'/);
  assert.match(register, /this\.bot\.command\('persona'/);
  assert.match(register, /this\.bot\.command\('language'/);
  assert.match(register, /this\.bot\.command\('translate'/);
  assert.match(register, /this\.bot\.command\('help'/);
});
