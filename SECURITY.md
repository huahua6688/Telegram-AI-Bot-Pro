# 安全说明

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

提交前运行：

    npm run check:secrets

## Token 泄露怎么办

Telegram Bot Token 泄露：

    去 BotFather revoke token，然后更新 Zeabur 的 BOT_TOKEN

Gemini API Key 泄露：

    删除旧 Key，创建新 Key，然后更新 Zeabur 的 GEMINI_API_KEY

Admin API Token 泄露：

    立即更换 ADMIN_API_TOKEN

普通部署建议：

    ADMIN_API_ENABLED=false
