import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

function extractBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);

  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);

  return source.slice(start, end);
}

function extractRunTranslation() {
  return extractBetween(
    '  async runTranslation(ctx, text = \'\', targetLanguage = \'auto\') {',
    '\n  normalizeLanguageInput'
  );
}

function extractClassifyUserIntent() {
  return extractBetween(
    '  async classifyUserIntent(ctx, text = \'\', memoryContext = null) {',
    '\n  async handleRoutedIntent'
  );
}

function extractIncomingMessageHandler() {
  return extractBetween(
    '  async handleIncomingMessage(ctx) {',
    '\n  async prepareUserMessage'
  );
}

test('translation uses translation fallback scope', () => {
  const block = extractRunTranslation();

  assert.match(block, /completeWithAiFallback\(\{/);
  assert.match(block, /scope:\s*'translation'/);
  assert.doesNotMatch(block, /scope:\s*'router'/);
});

test('router uses router fallback scope and a real locale value', () => {
  const block = extractClassifyUserIntent();

  assert.match(block, /completeWithAiFallback\(\{/);
  assert.match(block, /scope:\s*'router'/);
  assert.match(block, /locale:\s*this\.getLocale\(ctx\)/);
  assert.doesNotMatch(block, /locale,\s*\n/);
  assert.doesNotMatch(block, /scope:\s*'translation'/);
});

test('fallback handles cooldown instead of pre-blocking primary model', () => {
  const translationBlock = extractRunTranslation();
  const routerBlock = extractClassifyUserIntent();
  const incomingMessageBlock = extractIncomingMessageHandler();

  assert.doesNotMatch(
    translationBlock,
    /const cooldown = this\.getAiCooldown\('translation', model\)/
  );

  assert.doesNotMatch(
    routerBlock,
    /const cooldown = this\.getAiCooldown\('router', model\)/
  );

  assert.doesNotMatch(
    incomingMessageBlock,
    /const chatCooldown = this\.getAiCooldown\('chat', model\)/
  );
  assert.match(
    incomingMessageBlock,
    /!this\.providerManager && this\.isAiQuotaError\(error\)/
  );
  assert.match(incomingMessageBlock, /completion\.model/);
  assert.match(incomingMessageBlock, /已自动切换到 \$\{switchTarget\}/);
});
