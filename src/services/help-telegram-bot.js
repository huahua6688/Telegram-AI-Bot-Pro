import { PrivacyTelegramAIBot } from './privacy-telegram-bot.js';

function isEnglishLocale(locale = '') {
  return String(locale || '').toLowerCase().startsWith('en');
}

function buildHiddenFeatureHelp(locale = 'zh') {
  if (isEnglishLocale(locale)) {
    return [
      'Help',
      '',
      'Send text, photos, voice, files, or links and describe what you need.',
      'I can chat, search, translate, summarize, understand media, and help with code or errors.',
      'Open Console for models, settings, history, and credits. Use /whoami to view your Telegram ID.'
    ].join('\n');
  }

  return [
    '使用帮助',
    '',
    '直接发送文字、图片、语音、文件或链接，并说明你想做什么。',
    '我可以聊天、搜索、翻译、总结、识别媒体，以及协助代码和报错。',
    '模型、设置、记录和额度请打开「控制台」；查看 Telegram ID 使用 /whoami。'
  ].join('\n');
}

export class HelpTelegramAIBot extends PrivacyTelegramAIBot {
  async handleHelp(ctx) {
    if (this.config?.miniAppEnabled === false) {
      return super.handleHelp(ctx);
    }

    const locale = this.getLocale(ctx);
    const showWelcomeHelp = await this.canShowWelcomeHelp(ctx);
    await ctx.reply(
      buildHiddenFeatureHelp(locale),
      this.withWelcomeHelpButton(this.createBottomKeyboard(locale), locale, showWelcomeHelp)
    );
  }
}

export const helpTelegramBotInternals = {
  buildHiddenFeatureHelp
};
