export default function createTtsPlugin() {
  return {
    id: 'tts',
    commands: [
      {
        name: 'tts',
        description: 'Convert text to speech',
        naturalActionTypes: ['tts', 'tts_prompt'],
        async handler({ bot, ctx, action }) {
          const input = action?.type === 'tts_prompt' ? '' : action?.value;
          await bot.runTextToSpeech(ctx, input);
        }
      }
    ]
  };
}
