import { PrivacyTelegramAIBot } from './privacy-telegram-bot.js';

function isEnglishLocale(locale = '') {
  return String(locale || '').toLowerCase().startsWith('en');
}

function buildHiddenFeatureHelp(locale = 'zh') {
  if (isEnglishLocale(locale)) {
    return [
      'Help',
      '',
      'Send content directly. I will detect the right feature automatically; no feature buttons are required.',
      '',
      'Examples:',
      '- Chat: ask questions, write, rewrite, summarize, debug code, or analyze errors.',
      '- Web search: say “search today’s AI news” or “check the latest exchange rate”.',
      '- Translation: say “translate into Khmer: ...” or “translate this into Cantonese”.',
      '- Web links: send a URL and ask to summarize it or extract key points.',
      '- Images: send a photo for recognition or analysis. When an image provider is available, say “draw ...” to generate an image, or send an image with an edit instruction.',
      '- Voice: send voice/audio for transcription and chat. When supported, say “read aloud ...” to generate speech.',
      '- Files: send PDF, DOCX, XLSX, TXT, MD, JSON, CSV, or XML and ask for a summary, key points, or translation.',
      '- Memory and topics: say “show memory”, “show current topic”, “show topic list”, “clear memory”, or “clear topics”.',
      '- Private chat: use the “🔒 Private chat” button below. Private chat content is not written to the chat database.',
      '',
      'Open Console beside the message box for provider/model settings, persona, language, chat history, and administration.'
    ].join('\n');
  }

  return [
    '使用帮助',
    '',
    '直接发送内容，我会自动判断功能，不需要命令或功能按钮。',
    '',
    '可以这样使用：',
    '- 普通对话：直接提问、写作、改写、总结、代码和报错分析。',
    '- 联网搜索：说“搜索 今天的 AI 新闻”或“查一下最新汇率”。',
    '- 翻译：说“翻译成高棉语：……”或“把这句话翻译成粤语”。',
    '- 网页链接：发送链接并说“总结这个网页”或“提取重点”。',
    '- 图片：发送图片让我识别或分析；模型支持时，说“画一张……”可生成图片，发送图片并写编辑要求可修改图片。',
    '- 语音：发送语音或音频可转成文字并继续对话；模型支持时，说“朗读……”可生成语音。',
    '- 文件：发送 PDF、DOCX、XLSX、TXT、MD、JSON、CSV 或 XML，可要求总结、提取重点或翻译。',
    '- 记忆与话题：可说“查看记忆”“查看当前话题”“查看话题列表”“清空长期记忆”或“清空话题状态”。',
    '- 隐私聊天：使用下方“🔒 隐私聊天”按钮；隐私内容不写入聊天数据库。',
    '',
    'Provider/模型、人格、语言、聊天记录和管理员功能在输入框旁的“控制台”。'
  ].join('\n');
}

export class HelpTelegramAIBot extends PrivacyTelegramAIBot {
  async handleHelp(ctx) {
    if (this.config?.miniAppEnabled === false) {
      return super.handleHelp(ctx);
    }

    const locale = this.getLocale(ctx);
    await ctx.reply(
      buildHiddenFeatureHelp(locale),
      this.createBottomKeyboard(locale)
    );
  }
}

export const helpTelegramBotInternals = {
  buildHiddenFeatureHelp
};
