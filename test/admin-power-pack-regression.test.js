import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/services/telegram-bot.js", "utf8");

test("admin panel exposes power-pack buttons", () => {
  assert.match(source, /admin_pick:config_check/);
  assert.match(source, /admin_pick:version/);
  assert.match(source, /admin_pick:docs/);
  assert.match(source, /配置检查|Config check/);
  assert.match(source, /版本信息|Version/);
});

test("admin power-pack handlers exist", () => {
  assert.match(source, /async handleAdminConfigCheck\(ctx\)/);
  assert.match(source, /async handleAdminVersion\(ctx\)/);
  assert.match(source, /target === 'config_check'/);
  assert.match(source, /target === 'version'/);
});

test("deploy docs are real URL buttons", () => {
  assert.match(source, /createDeployDocsKeyboard\(locale = 'zh'\)/);
  assert.match(source, /Markup\.button\.url/);
  assert.match(source, /docs\/ZEABUR\.md/);
  assert.match(source, /docs\/ENVIRONMENT\.md/);
  assert.match(source, /docs\/DEPLOY_CHECKLIST\.md/);
});
