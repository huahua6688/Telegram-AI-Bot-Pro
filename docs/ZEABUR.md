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
    AI_PROVIDER
    GEMINI_API_KEY
    AI_MODEL
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

Telegram Mini App 入口为 `/app`。菜单按钮和网址由 BotFather 管理，程序不会重复修改。

## Admin API

普通部署建议关闭：

    ADMIN_API_ENABLED=false

只有做后台管理面板时才开启：

    ADMIN_API_ENABLED=true
    ADMIN_API_TOKEN=一串很长的随机密码
