import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

function extractMethod(name) {
  const marker = `  async ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);

  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
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

  throw new Error(`cannot extract ${name}`);
}

test("handleMenuCallback defines target before using it", () => {
  const body = extractMethod("handleMenuCallback");

  const defineIndex = body.indexOf("const target = String(ctx.match?.[1] || '').trim();");
  const useIndex = body.indexOf("target === 'close'");

  assert.ok(defineIndex >= 0, "target must be defined");
  assert.ok(useIndex > defineIndex, "target must be defined before use");
});

test("handleMenuAction does not use undefined target", () => {
  const body = extractMethod("handleMenuAction");

  assert.ok(!/target\s*===/.test(body), "handleMenuAction must not compare target");
  assert.match(body, /const type = String\(naturalAction\.type \|\| ''\)/);
});
