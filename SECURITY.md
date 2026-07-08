# 安全说明

这个项目会使用 Telegram Bot Token、Gemini API Key、Admin API Token 等敏感配置。

## 不要提交真实密钥

禁止提交：

    .env
    .env.*
    data/
    *.db
    *.sqlite
    *.sqlite3

允许提交：

    .env.example
    .env.zeabur.example

提交前可以运行：

    npm run check:secrets

或者完整检查：

    npm run verify

## 如果 Token 泄露了怎么办

### Telegram Bot Token 泄露

立即去 BotFather 重新生成 Token：

    /mybots
    选择你的 Bot
    API Token
    Revoke current token

然后把新 Token 填到 Zeabur：

    BOT_TOKEN=新的_Token

### Gemini API Key 泄露

立即到 Google AI Studio / Google Cloud 删除旧 Key，重新创建新 Key。

然后更新 Zeabur：

    GEMINI_API_KEY=新的_Key

### Admin API Token 泄露

如果开启了：

    ADMIN_API_ENABLED=true

并且 ADMIN_API_TOKEN 泄露，马上换一个长随机密码。

普通部署建议保持：

    ADMIN_API_ENABLED=false

## Zeabur 环境变量

真实密钥只填在 Zeabur 的 Environment Variables 里。

不要写进：

    README.md
    docs/*.md
    .env.example
    .env.zeabur.example

模板文件里只能写占位符。

## 数据库安全

Zeabur 推荐把数据挂载到：

    /data

并设置：

    DATABASE_FILE=/data/bot-data.db
    DATA_FILE=/data/bot-data.json

不要把数据库文件提交到 GitHub。

## 管理员权限

管理员通过：

    ADMIN_USER_IDS

控制。

获取 User ID：

    /whoami

多个管理员用英文逗号分隔：

    ADMIN_USER_IDS=123456789,987654321

不要随便把陌生人的 User ID 加进去。
