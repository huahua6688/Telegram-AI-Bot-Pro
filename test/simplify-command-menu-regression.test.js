import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

function getTelegramCommandMenuCommands() {
  const match = source.match(/await this\.bot\.telegram\.setMyCommands\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "missing setMyCommands block");

  return Array.from(match[1].matchAll(/command:\s*["']([^"']+)["']/g)).map((item) => item[1]);
}

test("Telegram slash command menu only shows button-first essentials", () => {
  const commands = getTelegramCommandMenuCommands();
  assert.deepEqual(commands, ["start", "menu", "whoami", "status"]);
});

test("hidden slash commands are still registered as fallback handlers", () => {
  for (const command of ["translate", "tr", "block", "unblock", "allow", "disallow"]) {
    assert.match(source, new RegExp(`this\\.bot\\.command\\(["']${command}["']`));
  }
});
