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
    GUARD_DEFAULT_ACTION=queue          未命中黑白名单的入群请求交给管理员
    BOT_COLLABORATION_COOLDOWN_MS=5000  同一 Bot 在同一群的最短回复间隔

Guest、Inline 和 Secretary 收到的第三方原文不会写入普通聊天记录或长期记忆。Guard 默认采用安全策略：黑名单拒绝、白名单/管理员通过、其他请求排队人工审核。

## Live API

普通部署先关闭：

    ENABLE_LIVE_AUDIO=false
    ENABLE_LIVE_TRANSLATE=false
