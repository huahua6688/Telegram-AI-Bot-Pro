# 故障排查

## Zeabur BackOff

先看日志有没有：

    Invalid runtime configuration

常见原因：

    BOT_TOKEN 没填
    GEMINI_API_KEY 没填
    AI_MODEL 没填
    ADMIN_API_ENABLED=true 但 ADMIN_API_TOKEN 没填

## Gemini 429

这是额度或频率限制。

推荐：

    AI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash
    TRANSLATION_MODEL=gemini-3.1-flash-lite
    ROUTER_MODEL=gemini-3.1-flash-lite

## /status 没权限

/status 是管理员命令。

先发：

    /whoami

然后把 User ID 填到：

    ADMIN_USER_IDS

## 数据丢失

确认 Zeabur 挂载了：

    /data

并设置：

    DATABASE_FILE=/data/bot-data.db
    DATA_FILE=/data/bot-data.json

## npm run verify 失败

看失败位置：

    check:secrets  误提交密钥或数据库
    check:syntax   JS 语法错误
    test:quick     测试失败
