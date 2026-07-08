# Copilot 交接说明

这个文件用于给 GitHub Copilot 智能体快速了解当前项目状态。

## 项目目标

Telegram AI Bot Pro 是一个部署到 Zeabur 的 Telegram AI Bot。

目标功能：

    多模型聊天
    Gemini 接入
    图像理解
    文件解析
    翻译
    记忆
    管理员权限
    Inline Button 交互
    Zeabur / Docker 部署

用户偏好：

    尽量不用 slash command
    优先使用按钮交互
    部署平台优先 Zeabur
    配置尽量清楚
    出错时要有明确日志和排查步骤

## 当前部署方式

推荐使用 Dockerfile 部署到 Zeabur。

部署前运行：

    npm run predeploy

Zeabur 环境变量模板：

    .env.zeabur.example

Zeabur 部署说明：

    docs/ZEABUR.md

## 当前检查命令

常用命令：

    npm run verify
    npm run doctor
    npm run docker:verify
    npm run predeploy

其中：

    verify        检查密钥文件、JS 语法、快速测试
    doctor        检查运行环境变量
    docker:verify 检查 Docker 构建和镜像内 doctor
    predeploy     部署前完整检查

## 重要环境变量

Zeabur 最少需要：

    BOT_TOKEN
    AI_PROVIDER
    GEMINI_API_KEY
    AI_MODEL
    ADMIN_USER_IDS

推荐：

    AI_FALLBACK_MODELS
    TRANSLATION_MODEL
    ROUTER_MODEL
    PORT
    HEALTH_PORT
    DATABASE_FILE
    DATA_FILE
    ADMIN_API_ENABLED=false

## 已完成的部署增强

已经加入：

    Dockerfile
    .dockerignore
    .gitignore
    .env.zeabur.example
    scripts/doctor.js
    scripts/docker-doctor.sh
    scripts/check-secrets.sh
    scripts/docker-healthcheck.js
    GitHub Actions CI
    Docker healthcheck
    runtime config validation
    Zeabur 部署文档
    环境变量文档
    故障排查文档
    部署检查清单

## 已知重点

### 1. 不要提交真实密钥

不能提交：

    .env
    .env.*
    data/
    *.db
    *.sqlite
    *.sqlite3

允许提交：

    .env.example
    .env.zeabur.example

### 2. Admin API 默认关闭

普通部署保持：

    ADMIN_API_ENABLED=false

只有做后台管理面板时才开启：

    ADMIN_API_ENABLED=true
    ADMIN_API_TOKEN=强随机密码

### 3. Zeabur 持久化目录

推荐挂载：

    /data

并设置：

    DATABASE_FILE=/data/bot-data.db
    DATA_FILE=/data/bot-data.json

### 4. Gemini 429

Gemini 429 是配额或频率限制。

应该优先使用 fallback models 和 cooldown，不要无限重试。

## 后续建议任务

优先级从高到低：

    1. 检查所有按钮交互是否完整
    2. 减少 slash command 依赖
    3. 优化 Gemini Live / Native Audio 接入
    4. 增强语音输入、TTS、文件解析
    5. 增加更多自动化测试
    6. 优化 README 首页展示
    7. 做一个更完整的管理面板

## 给 Copilot 的要求

修改项目时请遵守：

    每次改动后运行 npm run verify
    涉及部署时运行 npm run predeploy
    不要提交真实 token、API key、数据库文件
    不要破坏 Zeabur Docker 部署
    不要移除 /health 和 /ready
    不要把 ADMIN_API_ENABLED 默认改成 true
    不要让 Gemini 429 进入无限重试
