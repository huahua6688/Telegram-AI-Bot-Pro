export default function createWebPlugin() {
  return {
    id: 'web',
    commands: [
      {
        name: 'web',
        description: 'Search the web',
        naturalActionTypes: ['web', 'web_prompt'],
        async handler({ bot, ctx, action }) {
          const input = action?.type === 'web_prompt' ? '' : action?.value;
          await bot.runWebSearch(ctx, input);
        }
      }
    ]
  };
}
