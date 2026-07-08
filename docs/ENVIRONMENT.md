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

## Live API

普通部署先关闭：

    ENABLE_LIVE_AUDIO=false
    ENABLE_LIVE_TRANSLATE=false
