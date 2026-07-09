import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/product-agent.js", "utf8");

test("search and translation are handled by product agent", () => {
  assert.match(source, /runSmartSearch/);
  assert.match(source, /fetchNewsFallback/);
  assert.match(source, /trailingTranslateRegex/);
  assert.match(source, /translateModeRegex/);
});
