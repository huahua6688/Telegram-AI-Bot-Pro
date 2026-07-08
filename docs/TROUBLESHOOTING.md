# 故障排查

## 1. Zeabur BackOff / 容器反复重启

先打开 Zeabur 日志，搜索：

    Invalid runtime configuration

如果看到这个，通常是环境变量缺失或填错。

重点检查：

    BOT_TOKEN
    AI_PROVIDER
    GEMINI_API_KEY
    AI_MODEL
    ADMIN_USER_IDS

如果开启了 Admin API，还必须填写：

    ADMIN_API_TOKEN

普通部署建议保持：

    ADMIN_API_ENABLED=false

## 2. 容器启动了，但网页健康检查失败

检查端口：

    PORT=8080
    HEALTH_PORT=8080

健康检查地址：

    /
    /health
    /ready

推荐检查：

    /ready

## 3. 数据丢失 / 记忆丢失

确认 Zeabur 已经挂载磁盘到：

    /data

并且环境变量是：

    DATABASE_FILE=/data/bot-data.db
    DATA_FILE=/data/bot-data.json

如果没有挂载持久化磁盘，重新部署后数据可能会丢失。

## 4. Gemini 429 / quota exceeded

这是 Gemini 额度或频率限制。

推荐配置备用模型：

    AI_MODEL=gemini-2.5-flash
    AI_FALLBACK_MODELS=gemini-2.0-flash,gemini-2.5-flash-lite
    TRANSLATION_MODEL=gemini-2.5-flash-lite
    ROUTER_MODEL=gemini-2.5-flash-lite

Bot 会尝试备用模型，并对触发限制的模型进入冷却。

## 5. /status 提示没权限

/status 是管理员命令。

先给 Bot 发送：

    /whoami

然后把 User ID 填到 Zeabur：

    ADMIN_USER_IDS=你的_User_ID

多个管理员用英文逗号：

    ADMIN_USER_IDS=123456789,987654321

## 6. /whoami 也没反应

先确认 Bot Token 正确：

    BOT_TOKEN=你的_BotFather_Token

再确认 Zeabur 日志里有没有启动成功：

    Telegram bot launched

如果没有启动成功，继续看 BackOff 或 runtime configuration 错误。

## 7. npm run verify 失败

先看失败的是哪一段：

    check:secrets
    check:syntax
    test:quick

如果是 check:secrets，说明可能误提交了 .env、数据库或 data 文件。

如果是 check:syntax，说明 JS 语法有问题。

如果是 test:quick，说明测试发现功能逻辑不符合预期。

## 8. npm run docker:verify 失败

常见原因：

    Docker 没启动
    当前用户没有 Docker 权限
    Dockerfile 构建失败
    镜像内 doctor 检查失败

可以先单独运行：

    npm run docker:build
    npm run docker:doctor

看具体是哪一步失败。
