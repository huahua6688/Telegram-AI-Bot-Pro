const DEFAULT_TOPIC = 'general';

const TOPIC_RULES = [
  {
    topicId: 'telegram_bot',
    title: 'Telegram AI Bot 项目',
    keywords: [
      'telegram bot',
      'bot',
      '机器人',
      'zeabur',
      'gemini',
      'ai router',
      '翻译',
      '按钮',
      'backoff',
      'dockerfile',
      'huahua6688/telegram-ai-bot-pro'
    ]
  },
  {
    topicId: 'proxy_node',
    title: '代理节点 / x-ui / 3x-ui',
    keywords: [
      '节点',
      'x-ui',
      '3x-ui',
      '代理',
      'v2ray',
      'xray',
      '面板',
      '服务器',
      '端口',
      'vmess',
      'vless',
      'trojan',
      'hysteria'
    ]
  },
  {
    topicId: 'network_router',
    title: '网络 / 路由器 / 手机卡',
    keywords: [
      '路由器',
      'mr505',
      'tp-link',
      'u mobile',
      'celcomdigi',
      'dns',
      'wifi',
      '热点',
      '套餐',
      'sim'
    ]
  },
  {
    topicId: 'travel_malaysia',
    title: '马来西亚生活/旅行',
    keywords: [
      '马来西亚',
      '吉隆坡',
      '马币',
      'rm',
      '亚航',
      'ak265',
      '外卖',
      '插座'
    ]
  },
  {
    topicId: 'translation_chat',
    title: '翻译和语言交流',
    keywords: [
      '高棉语',
      '柬埔寨语',
      '粤语',
      '繁体',
      '翻译',
      '什么意思',
      'khmer',
      'cantonese'
    ]
  }
];

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function scoreTopic(text, topic) {
  const normalized = normalizeText(text);
  let score = 0;

  for (const keyword of topic.keywords) {
    const key = normalizeText(keyword);
    if (!key) continue;
    if (normalized.includes(key)) score += key.length >= 5 ? 2 : 1;
  }

  return score;
}

function truncate(value = '', max = 500) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export class MemoryManager {
  constructor({ db, aiClient = null, config = {}, logger = console } = {}) {
    this.db = db;
    this.aiClient = aiClient;
    this.config = config;
    this.logger = logger;
  }

  detectTopic({ text = '', activeTopicId = '' } = {}) {
    const content = String(text || '');
    let best = {
      topicId: activeTopicId || DEFAULT_TOPIC,
      title: activeTopicId || '通用对话',
      score: 0
    };

    for (const topic of TOPIC_RULES) {
      const score = scoreTopic(content, topic);
      if (score > best.score) {
        best = {
          topicId: topic.topicId,
          title: topic.title,
          score
        };
      }
    }

    if (best.score <= 0 && activeTopicId) {
      const knownTopic = TOPIC_RULES.find((topic) => topic.topicId === activeTopicId);
      return {
        topicId: activeTopicId,
        title: knownTopic?.title || activeTopicId,
        isSideQuestion: false,
        confidence: 0.4
      };
    }

    const isSideQuestion = Boolean(activeTopicId && best.topicId !== activeTopicId && best.score > 0);

    return {
      topicId: best.topicId || DEFAULT_TOPIC,
      title: best.title || '通用对话',
      isSideQuestion,
      confidence: best.score > 0 ? Math.min(0.95, 0.5 + best.score * 0.1) : 0.3
    };
  }

  getMemoryContext({ userId = '', chatId = '', text = '' } = {}) {
    const active = this.db.getActiveContext?.({ userId, chatId }) || null;
    const detected = this.detectTopic({
      text,
      activeTopicId: active?.activeTopicId || ''
    });

    const topicId = detected.topicId || DEFAULT_TOPIC;
    const topicState =
      this.db.getTopicState?.({
        userId,
        chatId,
        topicId
      }) || null;

    const recentTopics =
      this.db.listRecentTopicStates?.({
        userId,
        chatId,
        limit: 5
      }) || [];

    const memories =
      this.db.getMemoryItems?.({
        userId,
        chatId,
        topicId,
        limit: 12
      }) || [];

    const lines = [];

    lines.push('Relevant memory for this user:');

    if (active?.activeTopicId) {
      lines.push(`- Current main topic: ${active.activeTopicId}`);
    }

    if (detected.isSideQuestion && active?.activeTopicId) {
      lines.push(`- This message may be a side question. Answer it, then keep the main topic as ${active.activeTopicId}.`);
    }

    lines.push(`- Detected topic: ${topicId} (${detected.title})`);

    if (topicState) {
      lines.push(`- Topic title: ${topicState.title || topicId}`);
      if (topicState.summary) lines.push(`- Topic summary: ${topicState.summary}`);
      if (topicState.currentGoal) lines.push(`- Current goal: ${topicState.currentGoal}`);
      if (topicState.lastStep) lines.push(`- Last step: ${topicState.lastStep}`);
      if (topicState.nextStep) lines.push(`- Next step: ${topicState.nextStep}`);
    }

    if (recentTopics.length > 0) {
      lines.push('- Recent topics:');
      for (const topic of recentTopics) {
        lines.push(`  - ${topic.topicId}: ${topic.title || topic.summary || topic.topicId}`);
      }
    }

    if (memories.length > 0) {
      lines.push('- Long-term memory items:');
      for (const item of memories) {
        lines.push(`  - ${item.key ? `${item.key}: ` : ''}${item.value}`);
      }
    }

    return {
      topicId,
      title: detected.title,
      isSideQuestion: detected.isSideQuestion,
      returnTopicId: detected.isSideQuestion ? active?.activeTopicId || '' : '',
      text: lines.join('\n')
    };
  }

  touchTopic({ userId = '', chatId = '', topicId = DEFAULT_TOPIC, title = '', userText = '' } = {}) {
    const existing = this.db.getTopicState?.({ userId, chatId, topicId });

    this.db.upsertTopicState?.({
      userId,
      chatId,
      topicId,
      title: title || existing?.title || topicId,
      summary: existing?.summary || truncate(userText, 260),
      currentGoal: existing?.currentGoal || '',
      lastStep: existing?.lastStep || '',
      nextStep: existing?.nextStep || '',
      status: 'active'
    });
  }

  rememberProjectDefaults({ userId = '', chatId = '' } = {}) {
    const defaults = [
      {
        topicId: 'telegram_bot',
        memoryType: 'project',
        key: 'repo',
        value: 'Telegram AI Bot 项目仓库是 huahua6688/Telegram-AI-Bot-Pro，目标是部署到 Zeabur。'
      },
      {
        topicId: 'telegram_bot',
        memoryType: 'preference',
        key: 'reply_style',
        value: '用户喜欢中文、直接、给可复制命令，不喜欢大段废话。'
      },
      {
        topicId: 'telegram_bot',
        memoryType: 'project',
        key: 'bot_goal',
        value: '用户希望 Bot 像 ChatGPT 一样理解自然语言、自动判断意图、支持插话后继续原任务。'
      }
    ];

    for (const item of defaults) {
      this.db.upsertMemoryItem?.({
        userId,
        chatId,
        topicId: item.topicId,
        memoryType: item.memoryType,
        key: item.key,
        value: item.value,
        confidence: 0.9,
        source: 'system_seed'
      });
    }
  }

  updateAfterUserMessage({ userId = '', chatId = '', memoryContext = null, userText = '' } = {}) {
    if (!memoryContext?.topicId) return;

    this.touchTopic({
      userId,
      chatId,
      topicId: memoryContext.topicId,
      title: memoryContext.title,
      userText
    });

    if (memoryContext.isSideQuestion && memoryContext.returnTopicId) {
      this.db.setActiveContext?.({
        userId,
        chatId,
        activeTopicId: memoryContext.returnTopicId,
        returnTopicId: ''
      });
      return;
    }

    this.db.setActiveContext?.({
      userId,
      chatId,
      activeTopicId: memoryContext.topicId,
      returnTopicId: ''
    });
  }
}
