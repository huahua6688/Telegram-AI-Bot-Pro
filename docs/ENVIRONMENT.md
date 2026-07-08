# 环境变量说明

这个文件用于解释 Zeabur / Docker / 本地部署时常用的环境变量。

推荐优先参考：

    .env.zeabur.example

## 必填变量

### BOT_TOKEN

Telegram BotFather 给你的机器人 Token。

示例：

    BOT_TOKEN=123456789:xxxxxxxx

不要提交到 GitHub。

### AI_PROVIDER

AI 服务提供商。

Gemini 推荐：

    AI_PROVIDER=gemini

### GEMINI_API_KEY

Google Gemini API Key。

当 AI_PROVIDER=gemini 时必填。

    GEMINI_API_KEY=你的_Gemini_API_Key

不要提交到 GitHub。

### AI_MODEL

默认聊天模型。

推荐：

    AI_MODEL=gemini-2.5-flash

### ADMIN_USER_IDS

Telegram 管理员 User ID。

部署后给 Bot 发送：

    /whoami

把显示的 User ID 填进去。

多个管理员用英文逗号分隔：

    ADMIN_USER_IDS=123456789,987654321

## 推荐变量

### AI_FALLBACK_MODELS

备用模型列表。

当主模型额度不足或 429 时，Bot 会尝试备用模型。

推荐：

    AI_FALLBACK_MODELS=gemini-2.0-flash,gemini-2.5-flash-lite

### TRANSLATION_MODEL

翻译功能使用的模型。

推荐用轻量模型，减少额度消耗：

    TRANSLATION_MODEL=gemini-2.5-flash-lite

### ROUTER_MODEL

AI 路由判断使用的模型。

推荐：

    ROUTER_MODEL=gemini-2.5-flash-lite

### PORT

Zeabur 暴露端口。

推荐：

    PORT=8080

### HEALTH_PORT

健康检查服务端口。

推荐和 PORT 一样：

    HEALTH_PORT=8080

### DATABASE_FILE

SQLite 数据库文件位置。

Zeabur 挂载磁盘时推荐：

    DATABASE_FILE=/data/bot-data.db

### DATA_FILE

旧数据文件位置。

Zeabur 挂载磁盘时推荐：

    DATA_FILE=/data/bot-data.json

### ADMIN_API_ENABLED

后台 Admin API 开关。

普通 Telegram Bot 部署建议关闭：

    ADMIN_API_ENABLED=false

只有以后做后台管理面板时才需要开启。

### ADMIN_API_TOKEN

Admin API 密码。

只有 ADMIN_API_ENABLED=true 时才需要填写。

不要提交到 GitHub。

## 功能开关

### ENABLE_AI_ROUTER

是否启用 AI 路由。

推荐：

    ENABLE_AI_ROUTER=true

### AI_ROUTER_MODE

AI 路由模式。

推荐：

    AI_ROUTER_MODE=smart

### ENABLE_MEMORY_SUMMARY

是否启用记忆总结。

推荐：

    ENABLE_MEMORY_SUMMARY=true

### MEMORY_SUMMARY_INTERVAL

每多少轮对话总结一次记忆。

推荐：

    MEMORY_SUMMARY_INTERVAL=5

### ENABLE_TOOL_CALLS

是否允许工具调用。

推荐：

    ENABLE_TOOL_CALLS=true

### ENABLE_WEB_SEARCH

是否允许联网搜索。

推荐：

    ENABLE_WEB_SEARCH=true

### ENABLE_URL_FETCH

是否允许读取链接内容。

推荐：

    ENABLE_URL_FETCH=true

## 额度和频率限制

### DAILY_QUOTA

每天请求额度。

示例：

    DAILY_QUOTA=200

### RATE_LIMIT_WINDOW_MS

频率限制窗口，单位毫秒。

示例：

    RATE_LIMIT_WINDOW_MS=60000

### RATE_LIMIT_MAX_REQUESTS

每个窗口最多请求次数。

示例：

    RATE_LIMIT_MAX_REQUESTS=12

## Live API 相关

当前普通部署可以先关闭：

    ENABLE_LIVE_AUDIO=false
    ENABLE_LIVE_TRANSLATE=false

以后如果接 Gemini Live / 原生音频对话，再开启相关配置。
