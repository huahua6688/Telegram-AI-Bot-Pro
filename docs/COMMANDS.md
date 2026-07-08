# 常用命令说明

这个文件解释项目里常用的 npm 命令。

## 启动 Bot

    npm start

等同于：

    node src/index.js

用于正式启动 Telegram Bot。

## 开发模式

    npm run dev

使用 Node watch 模式启动，适合本地开发时自动重启。

## 快速测试

    npm run test:quick

运行项目核心快速测试。

适合每次改代码后先跑一次。

## 语法检查

    npm run check:syntax

检查 src、test、scripts 目录下的 JS 文件语法。

如果这里失败，通常是括号、引号、import/export 写错了。

## 配置检查

    npm run doctor

检查当前环境变量是否足够启动。

会检查：

    BOT_TOKEN
    AI_PROVIDER
    AI_MODEL
    GEMINI_API_KEY
    DATABASE_FILE
    DATA_FILE
    HEALTH_PORT
    ADMIN_USER_IDS

如果这里失败，说明配置还没填好。

## 密钥文件检查

    npm run check:secrets

检查有没有把 .env、数据库、data 目录误提交到 Git。

允许提交：

    .env.example
    .env.zeabur.example

不允许提交：

    .env
    .env.local
    data/
    *.db
    *.sqlite
    *.sqlite3

## 本地完整验证

    npm run verify

会依次运行：

    npm run check:secrets
    npm run check:syntax
    npm run test:quick

每次改代码后建议运行。

## Docker 构建

    npm run docker:build

构建 Docker 镜像。

Zeabur 部署前如果想确认 Dockerfile 没问题，可以运行它。

## Docker 内部配置检查

    npm run docker:doctor

在 Docker 镜像里面运行 doctor。

用于确认镜像内部也能通过配置检查。

## Docker 完整验证

    npm run docker:verify

会依次运行：

    npm run docker:build
    npm run docker:doctor

## 部署前完整检查

    npm run predeploy

部署到 Zeabur 前推荐运行。

它会检查：

    配置
    密钥文件
    JS 语法
    快速测试
    Docker 构建
    Docker 内部 doctor

如果 predeploy 失败，先不要部署。

## 推荐使用顺序

平时改文档：

    git status --short

平时改代码：

    npm run verify

准备部署：

    npm run predeploy

Zeabur 出错：

    npm run doctor
    npm run docker:verify
