# 环境变量说明

优先参考：

    .env.zeabur.example

## 必填

    BOT_TOKEN            Telegram BotFather Token
    DEFAULT_AI_PROVIDER  默认 AI 提供商；推荐 auto
    GEMINI_API_KEY       Gemini API Key
    DEFAULT_AI_MODEL     默认模型；推荐 gemini-2.5-flash
    ADMIN_USER_IDS       Telegram 管理员 User ID

## 推荐

    ENABLE_PROVIDER_FALLBACK=true
    AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter
    GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite
    AI_PROVIDER_MAX_RETRIES=1  首次失败后的额外重试次数；1 表示每个模型最多尝试 2 次
    TRANSLATION_MODEL    翻译模型
    ROUTER_MODEL         AI 路由模型
    PORT                 Zeabur 服务端口
    HEALTH_PORT          健康检查端口
    DATABASE_FILE        SQLite 数据库路径
    DATA_FILE            旧数据文件路径
    ADMIN_API_ENABLED    Admin API 开关

## Telegram 扩展模式

代码已支持 Inline Mode、Guest Chat Mode、Guard Mode、Secretary Mode 和 Bot-to-Bot Communication。
这些平台能力还必须在 BotFather 的 Bot Settings 中为当前 Bot 开启；`/help` 下方按钮会显示 Telegram 返回的实际能力状态。

    ENABLE_SECRETARY_AUTO_REPLY=true   Secretary 连接获得回复权限后自动答复
    GUARD_DEFAULT_ACTION=queue          Guard 初始模式：queue 审核 / approve 开放 / decline 严格
    BOT_COLLABORATION_COOLDOWN_MS=5000  同一 Bot 在同一群的最短回复间隔
    INLINE_QUERY_DEBOUNCE_MS=1200        停止输入多久后处理最后一条 Inline Query
    INLINE_QUERY_MIN_CHARS=2             少于此字符数只提示继续输入，不调用搜索或 AI
    INLINE_QUERY_RESPONSE_TIMEOUT_MS=8000 Inline Query 从收到到回复 Telegram 的总预算
    INLINE_QUERY_SEARCH_TIMEOUT_MS=2300   Inline 联网预取的最大等待时间
    INLINE_QUERY_AI_ATTEMPT_TIMEOUT_MS=2200 单个 AI 模型尝试的最大等待时间
    INLINE_QUERY_CACHE_TTL_MS=60000     相同 Inline 问题的个人缓存时间
    BRAVE_SEARCH_API_KEY=               稳定实时搜索建议配置；免密搜索仅为尽力而为的回退

真正跨平台回退需要为顺序中的备用平台分别配置独立 Key，例如 `GROQ_API_KEY` 和 `OPENROUTER_API_KEY`；只配置 Gemini Key 时，Gemini 额度耗尽后无法切换到其他平台。

Guest、Inline 和 Secretary 收到的第三方原文不会写入普通聊天记录或长期记忆。Guard 默认采用安全策略：黑名单拒绝、白名单/管理员通过、其他请求排队人工审核。

Guard 模式和动态名单保存在 SQLite：管理员可在 `/help` → `Guard Mode` 中选择“审核 / 开放 / 严格”，并使用按钮管理名单，也可发送 `/allow 用户ID`、`/disallow 用户ID`、`/block 用户ID`、`/unblock 用户ID`。黑名单始终优先拒绝，白名单和管理员始终优先通过，模式只决定其他用户的处理方式。

Bot 作为群管理员时会显式订阅 `chat_member` 更新：Telegram 将成员状态标记为 `kicked` 时自动加入动态黑名单，从 `kicked` 解除时自动移出。Telegram Bot API 不提供一次性读取群组完整“已移除用户”名单的接口，因此自动同步从部署并收到更新后开始；普通 `left`（包括主动退群）不会被误判为黑名单。`BLOCKED_USER_IDS` 和 `ALLOWED_USER_IDS` 仍是部署环境里的静态名单；其中 `ALLOWED_USER_IDS` 非空时也会限制普通 Bot 的访问范围，若只想控制 Guard，优先使用动态名单按钮或命令。

## Live API

普通部署先关闭：

    ENABLE_LIVE_AUDIO=false
    ENABLE_LIVE_TRANSLATE=false

这两个功能使用独立的 `GEMINI_LIVE_API_KEY` 和兼容模型；普通 `GEMINI_API_KEY` 不会自动开放 Live 功能。
