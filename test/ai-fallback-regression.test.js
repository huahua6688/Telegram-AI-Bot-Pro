import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

function extractMethod(name) {
  const start = source.indexOf(`  async ${name}`);
  assert.notEqual(start, -1, `missing method ${name}`);

  const next = source.indexOf('\n  async ', start + 1);
  const nextSync = source.indexOf('\n  ', start + 1);

  const endCandidates = [next, nextSync]
    .filter((item) => item > start)
    .sort((a, b) => a - b);

  const end = endCandidates[0] || source.length;
  return source.slice(start, end);
}

test('translation uses translation fallback scope', () => {
  const block = extractMethod('runTranslation');

  assert.match(block, /completeWithAiFallback\(\{/);
  assert.match(block, /scope:\s*'translation'/);
  assert.doesNotMatch(block, /scope:\s*'router'/);
});

test('router uses router fallback scope and a real locale value', () => {
  const block = extractMethod('classifyUserIntent');

  assert.match(block, /completeWithAiFallback\(\{/);
  assert.match(block, /scope:\s*'router'/);
  assert.match(block, /locale:\s*this\.getLocale\(ctx\)/);
  assert.doesNotMatch(block, /locale,\s*\n/);
  assert.doesNotMatch(block, /scope:\s*'translation'/);
});

test('fallback handles cooldown instead of pre-blocking primary model', () => {
  const translationBlock = extractMethod('runTranslation');
  const routerBlock = extractMethod('classifyUserIntent');

  assert.doesNotMatch(
    translationBlock,
    /const cooldown = this\.getAiCooldown\('translation', model\)/
  );

  assert.doesNotMatch(
    routerBlock,
    /const cooldown = this\.getAiCooldown\('router', model\)/
  );
});
