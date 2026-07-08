import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/services/telegram-bot.js', 'utf8');

test('voice menu exposes transcribe tts and live callbacks', () => {
  assert.match(source, /createVoiceActionKeyboard\(locale = 'zh'\)/);
  assert.match(source, /voice_pick:transcribe/);
  assert.match(source, /voice_pick:tts/);
  assert.match(source, /voice_pick:live/);
});

test('voice menu callback is registered and handled', () => {
  assert.match(source, /this\.bot\.action\(\/\^voice_pick:\(\.\+\)\$\//);
  assert.match(source, /async handleVoiceActionCallback\(ctx\)/);
});

test('voice pending actions support transcription tts and live placeholder', () => {
  assert.match(source, /voice_transcribe_prompt/);
  assert.match(source, /voice_tts_prompt/);
  assert.match(source, /voice_live_prompt/);
  assert.match(source, /async runVoiceTranscription\(ctx\)/);
  assert.match(source, /runTextToSpeech\(ctx, text\)/);
});
