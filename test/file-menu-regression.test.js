import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

test('main menu exposes file button', () => {
  assert.match(source, /buttonDocument/);
  assert.match(source, /menu:file/);
  assert.match(source, /file_menu/);
});

test('file menu exposes summarize keypoints and translate callbacks', () => {
  assert.match(source, /createFileActionKeyboard\(locale = 'zh'\)/);
  assert.match(source, /file_pick:summarize/);
  assert.match(source, /file_pick:keypoints/);
  assert.match(source, /file_pick:translate/);
});

test('file menu callback is registered and handled', () => {
  assert.match(source, /this\.bot\.action\(\/\^file_pick:\(\.\+\)\$\//);
  assert.match(source, /async handleFileActionCallback\(ctx\)/);
});

test('file pending actions call document action', () => {
  assert.match(source, /file_summarize_prompt/);
  assert.match(source, /file_keypoints_prompt/);
  assert.match(source, /file_translate_prompt/);
  assert.match(source, /async runDocumentAction\(ctx, mode = 'summarize'\)/);
  assert.match(source, /this\.documentParser\.parse/);
});
