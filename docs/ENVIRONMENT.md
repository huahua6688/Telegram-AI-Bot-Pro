# 环境变量说明

优先参考：

    .env.zeabur.example

## 必填

    BOT_TOKEN            Telegram BotFather Token
    AI_PROVIDER          AI 提供商，Gemini 用 gemini
    GEMINI_API_KEY       Gemini API Key
    AI_MODEL             默认模型
    ADMIN_USER_IDS       Telegram 管理员 User ID

## 推荐

    AI_FALLBACK_MODELS   备用模型
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
    INLINE_QUERY_CACHE_TTL_MS=60000     相同 Inline 问题的个人缓存时间

Guest、Inline 和 Secretary 收到的第三方原文不会写入普通聊天记录或长期记忆。Guard 默认采用安全策略：黑名单拒绝、白名单/管理员通过、其他请求排队人工审核。

Guard 模式和动态名单保存在 SQLite：管理员可在 `/help` → `Guard Mode` 中选择“审核 / 开放 / 严格”，并使用按钮管理名单，也可发送 `/allow 用户ID`、`/disallow 用户ID`、`/block 用户ID`、`/unblock 用户ID`。黑名单始终优先拒绝，白名单和管理员始终优先通过，模式只决定其他用户的处理方式。

Bot 作为群管理员时会显式订阅 `chat_member` 更新：Telegram 将成员状态标记为 `kicked` 时自动加入动态黑名单，从 `kicked` 解除时自动移出。Telegram Bot API 不提供一次性读取群组完整“已移除用户”名单的接口，因此自动同步从部署并收到更新后开始；普通 `left`（包括主动退群）不会被误判为黑名单。`BLOCKED_USER_IDS` 和 `ALLOWED_USER_IDS` 仍是部署环境里的静态名单；其中 `ALLOWED_USER_IDS` 非空时也会限制普通 Bot 的访问范围，若只想控制 Guard，优先使用动态名单按钮或命令。

## Live API

普通部署先关闭：

    ENABLE_LIVE_AUDIO=false
    ENABLE_LIVE_TRANSLATE=false
