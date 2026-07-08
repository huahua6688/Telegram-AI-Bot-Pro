# 部署前检查清单

## 本地检查

部署前运行：

    npm run predeploy

失败就先不要部署。

## Zeabur 环境变量

最少填写：

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

## 磁盘挂载

推荐挂载：

    /data

否则数据库和记忆可能在重新部署后丢失。

## 管理员确认

给 Bot 发送：

    /whoami

确认 User ID 已经填入：

    ADMIN_USER_IDS
