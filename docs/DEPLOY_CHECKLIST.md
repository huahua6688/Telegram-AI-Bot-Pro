# 部署前检查清单

## 1. 本地一键检查

部署到 Zeabur 前先运行：

    npm run predeploy

如果这里失败，先不要部署。

## 2. Zeabur 环境变量

最少需要填写：

    BOT_TOKEN
    AI_PROVIDER
    GEMINI_API_KEY
    AI_MODEL
    ADMIN_USER_IDS

推荐填写：

    PORT=8080
    HEALTH_PORT=8080
    DATABASE_FILE=/data/bot-data.db
    DATA_FILE=/data/bot-data.json
    ADMIN_API_ENABLED=false

## 3. Zeabur 磁盘挂载

建议挂载到：

    /data

否则数据库和记忆可能会在重新部署后丢失。

## 4. 健康检查

服务启动后检查：

    /
    /health
    /ready

推荐用：

    /ready

## 5. Bot 管理员检查

给 Bot 发送：

    /whoami

确认 User ID 已经填入：

    ADMIN_USER_IDS

多个管理员用英文逗号分隔：

    ADMIN_USER_IDS=123456789,987654321

## 6. 常见失败原因

### BackOff / 容器反复重启

优先看日志有没有：

    Invalid runtime configuration

常见原因：

    BOT_TOKEN 没填
    GEMINI_API_KEY 没填
    AI_MODEL 没填
    ADMIN_API_ENABLED=true 但 ADMIN_API_TOKEN 没填

### Gemini 429

这是 Gemini 配额或频率限制。

建议配置备用模型：

    AI_FALLBACK_MODELS=gemini-2.0-flash,gemini-2.5-flash-lite
    TRANSLATION_MODEL=gemini-2.5-flash-lite
    ROUTER_MODEL=gemini-2.5-flash-lite

### /status 没权限

/status 是管理员命令。

先用：

    /whoami

拿到 User ID，然后填到：

    ADMIN_USER_IDS
