# Telegram-AI-Bot-Pro

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/huahua6688/Telegram-AI-Bot-Pro)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/huahua6688/Telegram-AI-Bot-Pro)
[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/new?template=https://github.com/huahua6688/Telegram-AI-Bot-Pro)

一个尽量全能的 Telegram AI Bot 项目，基于 **Node.js + Telegraf**，支持：

- 多轮 AI 对话
- 私聊 / 群聊触发
- 多模型切换
- 人格切换
- 持久化会话记忆
- 图片理解
- 语音转文字
- 文本转语音
- 图片生成
- 联网搜索
- URL 内容抓取
- 管理员控制（allow / block）
- 速率限制与每日配额
- 健康检查与 Docker 部署

## 功能概览

### Telegram 核心能力
- 私聊直接对话
- 群聊支持 `@机器人`、回复机器人、关键词触发
- `/start`、`/help`、`/reset`、`/clear`
- `/model`、`/models`
- `/persona`
- `/stats`

### AI 与多模态能力
- OpenAI 兼容接口（可接 OpenAI / OpenRouter / 其他兼容服务）
- 图片输入分析
- 语音转文字后继续对话
- 文本转语音 `/tts`
- 图片生成 `/image`
- 文本文件读取与总结

### 智能增强能力
- 工具调用架构
- 联网搜索 `/web`
- URL 抓取辅助上下文
- 多人格预设
- 持久化会话记忆

### 管理与运维
- 用户 allow / block 控制
- 环境变量驱动配置
- 健康检查接口 `GET /`
- Docker / docker-compose 部署

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制示例文件：

```bash
cp .env.example .env
```

至少填写：

```env
BOT_TOKEN=你的Telegram机器人Token
AI_API_KEY=你的AI接口Key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
```

### 3. 启动项目

```bash
npm start
```

开发模式：

```bash
npm run dev
```

## 常用命令

- `/start` 启动说明
- `/help` 查看帮助
- `/reset` / `/clear` 清空当前会话记忆
- `/models` 查看可用模型
- `/model gpt-4.1-mini` 切换模型
- `/persona coder` 切换人格
- `/web 最新 AI 新闻` 联网搜索
- `/image 一只在赛博城市飞行的机械猫` 生成图片
- `/tts 你好，这是测试语音` 生成语音
- `/stats` 查看用量

## 群聊触发模式

默认 `GROUP_TRIGGER_MODE=smart`，支持：

- `smart`：@提及、回复机器人、包含关键词任一满足
- `all`：群内所有消息都响应
- `mention`：仅 @提及
- `reply`：仅回复机器人
- `keyword`：仅命中关键词

群里可动态调整：

- `/chatmode smart`
- `/keyword ai`

## 管理员命令

通过 `ADMIN_USER_IDS` 配置管理员后，可使用：

- `/block 用户ID`
- `/unblock 用户ID`
- `/allow 用户ID`
- `/disallow 用户ID`

## 主要环境变量

| 变量 | 说明 |
| --- | --- |
| `BOT_TOKEN` | Telegram Bot Token |
| `AI_API_KEY` | AI 提供商 API Key |
| `AI_BASE_URL` | OpenAI 兼容接口地址 |
| `AI_MODEL` | 默认模型 |
| `AI_FALLBACK_MODELS` | 可选模型列表，逗号分隔 |
| `AI_SYSTEM_PROMPT` | 默认系统提示词 |
| `ENABLE_TOOL_CALLS` | 是否启用工具调用 |
| `ENABLE_WEB_SEARCH` | 是否启用联网搜索 |
| `ENABLE_URL_FETCH` | 是否允许抓取 URL |
| `DATA_FILE` | 持久化数据文件 |
| `RATE_LIMIT_*` | 速率限制配置 |
| `DAILY_QUOTA` | 每用户每日配额 |
| `GROUP_TRIGGER_MODE` | 默认群聊触发模式 |
| `GROUP_TRIGGER_KEYWORD` | 默认群聊触发关键词 |

## 数据持久化

默认数据文件：

```text
data/bot-data.json
```

保存内容包括：
- 用户资料与偏好
- 群聊配置
- 会话历史
- 使用统计

## Docker 部署

```bash
docker compose up -d --build
```

## 一键部署到免费平台

点击上方徽章可一键部署，或按照下方各平台指引手动操作。

### Railway（推荐 ⭐）

Railway 支持 Docker 构建，免费层每月约 500 小时，支持持久化卷（付费层）。

1. 点击 **Deploy on Railway** 徽章或登录 [railway.app](https://railway.app)。
2. 选择 **Deploy from GitHub repo**，选择本仓库。
3. 在 **Variables** 中填写以下必填项：
   - `BOT_TOKEN` — Telegram Bot Token
   - `AI_API_KEY` — AI API Key
4. Railway 自动读取根目录 `railway.json` 和 `Dockerfile` 完成构建。
5. 如需持久化数据，在 **Volumes** 中挂载 `/app/data`，并设置 `DATA_FILE=/app/data/bot-data.json`。

### Render

Render 提供免费 Background Worker（免费层重启后磁盘数据会丢失，持久化需付费 Disk）。

1. 点击 **Deploy to Render** 徽章，授权后 Render 自动读取 `render.yaml`。
2. 在环境变量面板中填写 `BOT_TOKEN` 和 `AI_API_KEY`。
3. 如需持久化，升级服务并在 `render.yaml` 中的 `disk` 段已预配置挂载点 `/var/data`。

### Fly.io

Fly.io 免费层包含 3GB 持久化卷，最适合长期运行。

```bash
# 安装 flyctl
curl -L https://fly.io/install.sh | sh

# 登录
fly auth login

# 创建应用（会使用 fly.toml 配置）
fly launch --no-deploy

# 创建持久化卷
fly volumes create bot_data --size 1 --region sin

# 设置密钥（不要写在 fly.toml 中）
fly secrets set BOT_TOKEN=你的Token AI_API_KEY=你的Key

# 部署
fly deploy
```

### Zeabur

Zeabur 对中国区友好，自动识别 `Dockerfile` 和 `zbpack.json`。

1. 点击 **Deploy on Zeabur** 徽章，或登录 [zeabur.com](https://zeabur.com)。
2. 选择 **Deploy from GitHub**，选择本仓库。
3. 在服务的 **Variables** 面板中填写 `BOT_TOKEN` 和 `AI_API_KEY`。
4. 如需持久化，在服务中挂载 `/app/data` 卷，并设置 `DATA_FILE=/app/data/bot-data.json`。

### 自动同步部署（GitHub Actions）

仓库已内置 `.github/workflows/deploy.yml`，每次推送 `main` 分支时自动触发各平台 Deploy Hook。

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加：

| Secret 名称 | 来源 |
| --- | --- |
| `RAILWAY_DEPLOY_HOOK` | Railway → Service → Settings → Deploy Hook |
| `RENDER_DEPLOY_HOOK` | Render → Service → Settings → Deploy Hook |
| `ZEABUR_DEPLOY_HOOK` | Zeabur → Service → Settings → Deploy Hook |

不需要的平台留空即可，脚本会自动跳过。

## 测试

```bash
npm test
```

## 注意事项

- 图片理解、TTS、语音转文字、图片生成依赖你的 AI 服务是否兼容相应 OpenAI 接口。
- URL 抓取和联网搜索依赖运行环境的外网访问能力。
- 当前文本文件解析优先支持 txt / md / json / csv / xml 等文本类文件。
