export default function createImagePlugin() {
  return {
    id: 'image',
    commands: [
      {
        name: 'image',
        description: 'Generate an image',
        naturalActionTypes: ['image', 'image_prompt'],
        async handler({ bot, ctx, action }) {
          const input = action?.type === 'image_prompt' ? '' : action?.value;
          await bot.runImageGeneration(ctx, input);
        }
      }
    ]
  };
}
