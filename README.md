# Telegram-AI-Bot-Pro

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/huahua6688/Telegram-AI-Bot-Pro)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/huahua6688/Telegram-AI-Bot-Pro)
[![Deploy on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/new?template=https://github.com/huahua6688/Telegram-AI-Bot-Pro)

一个尽量全能的 Telegram AI Bot 项目，基于 **Node.js + Telegraf**，支持：

- 多轮 AI 对话
- 私聊 / 群聊触发
- 多模型切换
- 中英双语界面
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
- `/language`、`/menu`
- `/persona`
- `/stats`

### AI 与多模态能力
- 多平台 AI 提供商（OpenAI 兼容 / Anthropic / Gemini / Qwen / Grok / DeepSeek / GLM / Doubao）
- 插件化能力注册（`src/plugins/*-plugin.js` 自动加载）
- 图片输入分析
- 语音转文字后继续对话
- 文本转语音 `/tts`
- 图片生成 `/image`
- 文本文件读取与总结
- SQLite 持久化存储（兼容旧 JSON 数据自动迁移）

### 智能增强能力
- 工具调用架构
- 联网搜索 `/web`
- URL 抓取辅助上下文
- 多人格预设
- 常用功能按钮
- 常见需求自然语言识别
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
AI_PROVIDER=openai-compatible
AI_API_KEY=你的AI接口Key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
```

如果你不用 OpenAI 官方，可在 `AI_PROVIDER` 中切换到其他原生平台（见下方“AI 提供商配置示例”）。

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
- `/language en` 切换界面语言
- `/menu` 显示常用功能按钮
- `/web 最新 AI 新闻` 联网搜索
- `/image 一只在赛博城市飞行的机械猫` 生成图片
- `/tts 你好，这是测试语音` 生成语音
- `/stats` 查看用量
- 也支持直接发送：`搜索 OpenAI 最新消息`、`生成图片 一只机械猫`、`朗读 这段文本`

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
| `AI_PROVIDER` | 提供商类型：`openai-compatible` / `anthropic` / `gemini` / `qwen` / `grok` / `deepseek` / `glm` / `doubao` |
| `AI_API_KEY` | AI 提供商 API Key |
| `AI_BASE_URL` | OpenAI 兼容接口地址（`openai-compatible` 时使用） |
| `ANTHROPIC_API_KEY` | Anthropic API Key（可选，不填则复用 `AI_API_KEY`） |
| `ANTHROPIC_BASE_URL` | Anthropic API 地址 |
| `ANTHROPIC_API_VERSION` | Anthropic API 版本头 |
| `GEMINI_API_KEY` | Gemini API Key（可选，不填则复用 `AI_API_KEY`） |
| `GEMINI_BASE_URL` | Gemini API 地址 |
| `QWEN_API_KEY` / `QWEN_BASE_URL` | 通义千问 API Key / 地址 |
| `GROK_API_KEY` / `GROK_BASE_URL` | Grok API Key / 地址 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` | DeepSeek API Key / 地址 |
| `GLM_API_KEY` / `GLM_BASE_URL` | 智谱 GLM API Key / 地址 |
| `DOUBAO_API_KEY` / `DOUBAO_BASE_URL` | 豆包 API Key / 地址 |
| `AI_MODEL` | 默认模型 |
| `AI_FALLBACK_MODELS` | 可选模型列表，逗号分隔 |
| `AI_SYSTEM_PROMPT` | 默认系统提示词 |
| `ENABLE_TOOL_CALLS` | 是否启用工具调用 |
| `ENABLE_WEB_SEARCH` | 是否启用联网搜索 |
| `ENABLE_URL_FETCH` | 是否允许抓取 URL |
| `DATABASE_FILE` | SQLite 数据库文件 |
| `DATA_FILE` | 旧版 JSON 数据文件（首次启动可自动迁移） |
| `RATE_LIMIT_*` | 速率限制配置 |
| `DAILY_QUOTA` | 每用户每日配额 |
| `GROUP_TRIGGER_MODE` | 默认群聊触发模式 |
| `GROUP_TRIGGER_KEYWORD` | 默认群聊触发关键词 |

## AI 提供商配置示例（重点）

本项目当前已支持以下原生 provider：
- `openai-compatible`（OpenAI / OpenRouter / 其他兼容网关）
- `anthropic`（Claude 官方 API）
- `gemini`（Google Gemini 官方 API）
- `qwen`（通义千问）
- `grok`（xAI Grok）
- `deepseek`（DeepSeek）
- `glm`（智谱 GLM）
- `doubao`（火山引擎豆包/Ark）

第一批优先原生平台：`qwen`、`grok`、`deepseek`、`glm`、`doubao`。

### 1) OpenAI 官方（兼容接口）

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4.1-mini
```

### 2) OpenRouter（兼容接口，可用 Gemini / Claude / DeepSeek 等）

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=sk-or-...
AI_MODEL=google/gemini-2.0-flash-001
```

### 3) Anthropic 官方

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-3-5-sonnet-latest
```

### 4) Gemini 官方

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=AIza...
AI_MODEL=gemini-2.0-flash
```

### 5) Qwen（通义千问）官方

```env
AI_PROVIDER=qwen
QWEN_API_KEY=sk-...
AI_MODEL=qwen-plus
```

### 6) Grok（xAI）官方

```env
AI_PROVIDER=grok
GROK_API_KEY=xai-...
AI_MODEL=grok-3-mini-beta
```

### 7) DeepSeek 官方

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
AI_MODEL=deepseek-chat
```

### 8) 智谱 GLM 官方

```env
AI_PROVIDER=glm
GLM_API_KEY=...
AI_MODEL=glm-4-flash
```

### 9) 豆包（火山引擎 Ark）官方

```env
AI_PROVIDER=doubao
DOUBAO_API_KEY=...
AI_MODEL=doubao-seed-1-6-250615
```

> 注意：`AI_PROVIDER` 与密钥、模型必须是一组匹配配置，不能混用。
> 另外请使用 `AI_API_KEY` 变量名（不是 `OPENAI_API_KEY`）作为统一兜底密钥变量。

## 能力矩阵与降级策略

| Provider | 文本对话 | 工具调用 | 图片理解 | 图片生成 | 语音转文字 | 文字转语音 |
| --- | --- | --- | --- | --- | --- | --- |
| openai-compatible | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| anthropic | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| gemini | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| qwen | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| grok | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| deepseek | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| glm | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| doubao | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

降级策略：
- 不支持的 `/image`、`/tts` 会直接提示切换支持该能力的平台。
- 不支持图片理解的平台收到图片时，会降级为文本提示，不会中断会话流程。
- 不支持语音转写的平台收到语音时，会降级为文本提示，不会中断会话流程。
- 不支持工具调用的平台会自动关闭工具调用，保持纯对话可用。

## 数据持久化

默认 SQLite 数据文件：

```text
data/bot-data.db
```

保存内容包括：
- 用户资料与偏好
- 群聊配置
- 会话历史
- 使用统计

兼容旧版 `data/bot-data.json`：
- 如果存在旧 JSON 数据，首次启动会自动导入到 SQLite
- 导入后主存储以 `DATABASE_FILE` 为准

## Docker 部署

```bash
docker compose up -d --build
```

## 一键部署到免费平台

点击上方徽章可一键部署，或按照下方各平台指引手动操作。

### 部署变量（先看这个）

- **程序启动必填（最小集）**
  - `BOT_TOKEN`
  - AI 平台密钥（以下至少一个）：`AI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `QWEN_API_KEY` / `GROK_API_KEY` / `DEEPSEEK_API_KEY` / `GLM_API_KEY` / `DOUBAO_API_KEY`
- **强烈建议同时填写（避免平台默认值导致配置歧义）**
  - `AI_PROVIDER`
  - `AI_MODEL`
- **按需可选**
  - `AI_BASE_URL`（仅 `openai-compatible` 或代理网关场景常用）
  - `DATABASE_FILE`（需要持久化挂载时设置）

### Railway（推荐 ⭐）

Railway 支持 Docker 构建，免费层每月约 500 小时，支持持久化卷（付费层）。

1. 点击 **Deploy on Railway** 徽章或登录 [railway.app](https://railway.app)。
2. 选择 **Deploy from GitHub repo**，选择本仓库。
3. 在 **Variables** 中填写以下必填项：
   - `BOT_TOKEN` — Telegram Bot Token
   - `AI_PROVIDER` — `openai-compatible` / `anthropic` / `gemini` / `qwen` / `grok` / `deepseek` / `glm` / `doubao`
   - `AI_MODEL` — 模型 ID
   - 密钥变量：`AI_API_KEY`（通用）或对应平台专用 key（如 `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `QWEN_API_KEY` / `GROK_API_KEY` / `DEEPSEEK_API_KEY` / `GLM_API_KEY` / `DOUBAO_API_KEY`）
4. Railway 自动读取根目录 `railway.json` 和 `Dockerfile` 完成构建。
5. 如需持久化数据，在 **Volumes** 中挂载 `/app/data`，并设置 `DATABASE_FILE=/app/data/bot-data.db`。

### Render

Render 提供免费 Background Worker（免费层重启后磁盘数据会丢失，持久化需付费 Disk）。

1. 点击 **Deploy to Render** 徽章，授权后 Render 自动读取 `render.yaml`。
2. 在环境变量面板中填写 `BOT_TOKEN`、`AI_PROVIDER`、`AI_MODEL` 和密钥变量（`AI_API_KEY` 或对应平台专用 key）。
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
fly secrets set BOT_TOKEN=你的Token AI_PROVIDER=openai-compatible AI_MODEL=gpt-4.1-mini AI_API_KEY=你的Key

# 部署
fly deploy
```

### Zeabur

Zeabur 对中国区友好，推荐直接使用 **Deploy from GitHub** 导入仓库。

1. 点击 **Deploy on Zeabur** 徽章，或登录 [zeabur.com](https://zeabur.com)。
2. 选择 **Deploy from GitHub**，选择本仓库与分支（通常 `main`）。
3. Build 配置建议：
   - Build Method: `Dockerfile`
   - Dockerfile Path: `Dockerfile`
   - Build Context: `.`
4. 在服务的 **Variables** 面板中填写：
   - `BOT_TOKEN`
   - `AI_PROVIDER`
   - `AI_API_KEY`（或平台专用 key）
   - `AI_BASE_URL`（仅 `openai-compatible` 需要）
   - `AI_MODEL`
5. 如需持久化，在服务中挂载 `/app/data` 卷，并设置 `DATABASE_FILE=/app/data/bot-data.db`。

如果你使用 **Arbitrary Git service**：
- 必填 `gitURL`（例如 `https://github.com/huahua6688/Telegram-AI-Bot-Pro.git`）
- 平台不会自动检测构建方式，需手动填写 Dockerfile 相关字段

### 常见报错速查

- `invalid_api_key (401)`  
  密钥无效，或 `AI_PROVIDER` / 接口地址 / 模型组合不匹配（比如拿 A 平台 key 去请求 B 平台）。
- `Dockerfile is required for arbitrary Git sources`  
  你在 Arbitrary Git 模式下未配置 Dockerfile 路径与上下文。
- `gitURL is required for arbitrary git service`  
  你选择了 Arbitrary Git 但没填 `gitURL`。

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

## Phase 1 架构变化

- 持久化层已切换为 SQLite
- `src/plugins/*-plugin.js` 会自动注册 `/web`、`/image`、`/tts` 等可扩展能力
- 聊天回复支持 Telegram 端渐进式流式输出

## 注意事项

- 图片理解支持多平台；`/tts`、语音转文字、`/image` 当前仅在 `openai-compatible` 提供商可用。
- URL 抓取和联网搜索依赖运行环境的外网访问能力。
- 当前文本文件解析优先支持 txt / md / json / csv / xml 等文本类文件。
