import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

test('image menu exposes understand, generate, and edit callbacks', () => {
  assert.match(source, /createImageActionKeyboard\(locale = 'zh'\)/);
  assert.match(source, /image_pick:understand/);
  assert.match(source, /image_pick:generate/);
  assert.match(source, /image_pick:edit/);
});

test('image menu callback is registered and handled', () => {
  assert.match(source, /this\.bot\.action\(\/\^image_pick:\(\.\+\)\$\//);
  assert.match(source, /async handleImageActionCallback\(ctx\)/);
});

test('image pending actions support understand generate and edit flows', () => {
  assert.match(source, /image_understand_prompt/);
  assert.match(source, /image_generate_prompt/);
  assert.match(source, /image_edit_prompt/);
  assert.match(source, /runImageGeneration\(ctx, prompt, 'generate'\)/);
  assert.match(source, /runImageEdit\(ctx, prompt\)/);
});
