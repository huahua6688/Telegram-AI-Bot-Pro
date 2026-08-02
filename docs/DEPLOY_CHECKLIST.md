# 部署前检查清单

## 本地检查

部署前运行：

    npm run predeploy

失败就先不要部署。

## Zeabur 环境变量

最少填写：

    BOT_TOKEN
    DEFAULT_AI_PROVIDER=auto
    GEMINI_API_KEY
    DEFAULT_AI_MODEL=gemini-2.5-flash
    ADMIN_USER_IDS

推荐填写：

    ENABLE_PROVIDER_FALLBACK=true
    AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter
    PORT=8080
    HEALTH_PORT=8080
    ENABLE_STARTUP_DIAGNOSTICS=true
    HEALTH_CHECK_ENABLED=true
    SHOW_VERSION_INFO=true
    DATABASE_FILE=/data/bot-data.db
    DATA_FILE=/data/bot-data.json
    ADMIN_API_ENABLED=false

如启用独立客服 Bot，再填写：

    SUPPORT_ENABLED=true
    SUPPORT_BOT_TOKEN=第二个 BotFather Token
    SUPPORT_BOT_USERNAME=客服机器人用户名
    SUPPORT_ADMIN_IDS=客服管理员 Telegram ID

确认 `SUPPORT_BOT_TOKEN` 与主 `BOT_TOKEN` 不同；如使用自定义客服页面，可改填 `SUPPORT_CONTACT_URL`。

确认六类 `STARS_FREE_*_DAILY` 免费额度和 `STARS_PRODUCTS_JSON` 已从 `.env.zeabur.example` 复制，避免 Bot、Mini App 与后台显示不同数值。

## 磁盘挂载

推荐挂载：

    /data

否则数据库和记忆可能在重新部署后丢失。

## 管理员确认

给 Bot 发送：

    /whoami

确认 User ID 已经填入：

    ADMIN_USER_IDS
