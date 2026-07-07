# Zeabur 部署指南

## 部署前检查

每次部署前运行：

npm run predeploy

它会检查配置、语法、测试、Docker 构建和 Docker 内部 doctor。

## Zeabur 推荐设置

Build 方式：Dockerfile

端口：

PORT=8080
HEALTH_PORT=8080

持久化目录建议挂载到：

/data

数据库变量：

DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json

## 必填环境变量

BOT_TOKEN=你的 BotFather Token
AI_PROVIDER=gemini
GEMINI_API_KEY=你的 Gemini API Key

AI_MODEL=gemini-2.5-flash
AI_FALLBACK_MODELS=gemini-2.0-flash,gemini-2.5-flash-lite
TRANSLATION_MODEL=gemini-2.5-flash-lite
ROUTER_MODEL=gemini-2.5-flash-lite

ADMIN_USER_IDS=你的 Telegram 用户 ID

## 怎么查看 Telegram 用户 ID

部署后给机器人发送：

/whoami

然后把 User ID 填到 Zeabur 的 ADMIN_USER_IDS。

## Admin API

默认关闭：

ADMIN_API_ENABLED=false

普通部署不用开。

如果以后要做后台管理面板，再设置：

ADMIN_API_ENABLED=true
ADMIN_API_TOKEN=一串很长的随机密码

## 常见问题

如果 Zeabur BackOff，先看日志有没有：

Invalid runtime configuration

一般是 BOT_TOKEN、GEMINI_API_KEY、AI_MODEL 或 ADMIN_API_TOKEN 缺失。

如果 Gemini 429，说明免费额度限制了。Bot 会自动尝试备用模型并进入冷却。
