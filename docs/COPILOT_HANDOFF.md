# Copilot 交接说明

## 项目目标

Telegram AI Bot Pro 是一个部署到 Zeabur 的 Telegram AI Bot。

目标：

    多模型聊天
    Gemini 接入
    图像理解
    文件解析
    翻译
    记忆
    管理员权限
    Inline Button 交互
    Docker / Zeabur 部署

## 部署方式

推荐 Dockerfile 部署到 Zeabur。

部署前运行：

    npm run predeploy

## 重要规则

不要提交：

    .env
    .env.*
    data/
    *.db
    *.sqlite
    *.sqlite3

允许提交：

    .env.example
    .env.zeabur.example

Admin API 默认保持：

    ADMIN_API_ENABLED=false

不要让 Gemini 429 无限重试。
