export default function createImagePlugin() {
  return {
    id: 'image',
    commands: [
      {
        name: 'image',
        description: 'Generate an image',
        naturalActionTypes: ['image', 'image_prompt', 'image_edit', 'image_edit_prompt'],
        async handler({ bot, ctx, action }) {
          const input = action?.type === 'image_prompt' || action?.type === 'image_edit_prompt' ? '' : action?.value;
          const mode = action?.type?.startsWith('image_edit') ? 'edit' : 'generate';
          if (mode === 'edit') {
            await bot.runImageEdit(ctx, input);
            return;
          }
          await bot.runImageGeneration(ctx, input, mode);
        }
      }
    ]
  };
}
