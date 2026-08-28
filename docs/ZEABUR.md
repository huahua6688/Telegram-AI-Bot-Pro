# Zeabur 部署指南

## 部署方式

推荐使用项目内置 Dockerfile 部署到 Zeabur。

Zeabur 设置：

    Build: Dockerfile
    Port: 8080

部署前建议运行：

    npm run predeploy

## 必填环境变量

参考：

    .env.zeabur.example

最少需要：

    BOT_TOKEN
    DEFAULT_AI_PROVIDER=auto
    GEMINI_API_KEY
    DEFAULT_AI_MODEL=gemini-2.5-flash
    ADMIN_USER_IDS

不知道 Telegram User ID 时，部署后给 Bot 发送：

    /whoami

然后把 User ID 填到：

    ADMIN_USER_IDS

## 持久化数据

建议 Zeabur 挂载磁盘到：

    /data

并设置：

    DATABASE_FILE=/data/bot-data.db
    DATA_FILE=/data/bot-data.json

## 健康检查

可访问：

    /
    /health
    /ready

推荐使用：

    /ready

`/health` 返回状态、运行时长、版本、Provider、时间戳和安全的部署信息，不包含 Token 或 API Key。通过以下变量控制：

    ENABLE_STARTUP_DIAGNOSTICS=true
    HEALTH_CHECK_ENABLED=true
    SHOW_VERSION_INFO=true

如果希望隐藏公开健康页，可设置 `HEALTH_CHECK_ENABLED=false`；`/ready` 仍保持可用，避免平台就绪探针失效。

## 客服 Bot

独立客服 Bot 使用第二个 BotFather Token：

    SUPPORT_ENABLED=true
    SUPPORT_BOT_TOKEN=
    SUPPORT_BOT_USERNAME=
    SUPPORT_CONTACT_URL=
    SUPPORT_ADMIN_IDS=

主 Token 与客服 Token 必须不同。`SUPPORT_CONTACT_URL` 优先；未配置时通过 `SUPPORT_BOT_USERNAME` 生成 Telegram 链接。客服管理员 ID 使用英文逗号分隔。

Telegram Mini App 入口为 `/app`。菜单按钮和网址由 BotFather 管理，程序不会重复修改。

## Admin API

普通部署建议关闭：

    ADMIN_API_ENABLED=false

只有做后台管理面板时才开启：

    ADMIN_API_ENABLED=true
    ADMIN_API_TOKEN=至少32位随机值

生产环境还必须在 Zeabur Secret 变量中配置以下设置，其中两个随机密钥必须不同：

    CHAT_ENCRYPTION_REQUIRED=true
    CHAT_ENCRYPTION_KEY=运行 openssl rand -base64 48 生成
    LOG_PRIVACY_KEY=再次生成

启用 GitHub App 时另行设置 `GITHUB_TOKEN_ENCRYPTION_KEY`，不得复用上面两个值。
