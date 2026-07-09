# Telegram-AI-Bot-Pro

<!-- ZEABUR_DEPLOY_START -->
## Zeabur 部署入口

本项目推荐使用 Dockerfile 部署到 Zeabur。

部署前检查：

    npm run predeploy

Zeabur 环境变量模板：

    .env.zeabur.example

完整部署说明：

    docs/ZEABUR.md

文档索引：

    docs/README.md

常用命令说明：

    docs/COMMANDS.md

安全说明：

    SECURITY.md

最少需要在 Zeabur 填写：

    BOT_TOKEN
    AI_PROVIDER
    GEMINI_API_KEY
    AI_MODEL
    ADMIN_USER_IDS

不知道自己的 Telegram 用户 ID 时，部署后给机器人发送：

    /whoami
<!-- ZEABUR_DEPLOY_END -->


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
- 图片生成/编辑
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
- 图片生成/编辑 `/image`
- 文本文件读取与总结（TXT/MD/JSON/CSV/XML/PDF/DOCX/XLSX）
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
- 后台管理 API（默认前缀 `/admin/api/v1`，基于 `ADMIN_API_TOKEN` 鉴权）
- 环境变量驱动配置
- 健康检查接口 `GET /`
- Docker / docker-compose 部署

## 快速开始

### 0. 运行环境

- Node.js `>=22.5.0`

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

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `BOT_TOKEN` | Telegram Bot Token | `123456789:AAF...` |
| `AI_PROVIDER` | 提供商类型：`openai-compatible` / `anthropic` / `gemini` / `gemini-live` / `qwen` / `grok` / `deepseek` / `glm` / `doubao` | `openai-compatible` |
| `AI_API_KEY` | AI 提供商 API Key | `sk-...` |
| `AI_BASE_URL` | OpenAI 兼容接口地址（`openai-compatible` 时使用） | `https://api.openai.com/v1` |
| `ANTHROPIC_API_KEY` | Anthropic API Key（可选，不填则复用 `AI_API_KEY`） | `sk-ant-...` |
| `ANTHROPIC_BASE_URL` | Anthropic API 地址 | `https://api.anthropic.com` |
| `ANTHROPIC_API_VERSION` | Anthropic API 版本头 | `2023-06-01` |
| `GEMINI_API_KEY` | Gemini API Key（可选，不填则复用 `AI_API_KEY`） | `AIza...` |
| `GEMINI_BASE_URL` | Gemini API 地址 | `https://generativelanguage.googleapis.com/v1beta` |
| `GEMINI_LIVE_API_KEY` / `GEMINI_LIVE_BASE_URL` | Gemini Live API Key / 地址 | `AIza...` / `https://generativelanguage.googleapis.com/v1beta` |
| `GEMINI_LIVE_TRANSCRIPTION_MODEL` / `GEMINI_LIVE_TTS_MODEL` | Gemini Live 语音转写 / 语音生成模型 | `gemini-2.5-flash-preview-native-audio-dialog` |
| `QWEN_API_KEY` / `QWEN_BASE_URL` | 通义千问 API Key / 地址 | `sk-...` / `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `GROK_API_KEY` / `GROK_BASE_URL` | Grok API Key / 地址 | `xai-...` / `https://api.x.ai/v1` |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` | DeepSeek API Key / 地址 | `sk-...` / `https://api.deepseek.com/v1` |
| `GLM_API_KEY` / `GLM_BASE_URL` | 智谱 GLM API Key / 地址 | `your_glm_key` / `https://open.bigmodel.cn/api/paas/v4` |
| `DOUBAO_API_KEY` / `DOUBAO_BASE_URL` | 豆包 API Key / 地址 | `your_doubao_key` / `https://ark.cn-beijing.volces.com/api/v3` |
| `AI_MODEL` | 默认模型 | `gpt-4.1-mini` |
| `AI_FALLBACK_MODELS` | 可选模型列表，逗号分隔 | `gpt-4.1-mini,gpt-4o-mini` |
| `DOCUMENT_MAX_BYTES` / `DOCUMENT_MAX_CHARS` / `DOCUMENT_CHUNK_CHARS` | 文档解析大小与分片限制 | `6291456` / `12000` / `1800` |
| `AI_SYSTEM_PROMPT` | 默认系统提示词 | `You are a powerful Telegram AI assistant.` |
| `ENABLE_TOOL_CALLS` | 是否启用工具调用 | `true` |
| `ENABLE_WEB_SEARCH` | 是否启用联网搜索 | `true` |
| `ENABLE_GEMINI_GOOGLE_SEARCH` | Gemini 3+ 是否启用原生 Google Search Grounding | `true` |
| `ENABLE_URL_FETCH` | 是否允许抓取 URL | `true` |
| `TOOL_ALLOWED_*` / `TOOL_BLOCKED_*` | 工具调用用户/群组白名单与黑名单 | `TOOL_ALLOWED_USER_IDS=123456,789012` |
| `TOOL_MAX_CALLS_PER_MESSAGE` | 单次请求工具调用上限 | `4` |
| `TOOL_USER_WINDOW_MS` / `TOOL_USER_MAX_CALLS` | 工具调用频率限制 | `60000` / `20` |
| `NETWORK_TOOL_SCOPE` / `NETWORK_TOOL_ALLOWED_*` | 联网工具权限分层控制 | `all` |
| `ENABLE_LIVE_AUDIO` / `ENABLE_LIVE_TRANSLATE` | Live Audio/Translate 编排开关 | `true` / `true` |
| `ENABLE_STREAMING_REPLIES` | 是否启用流式输出 | `true` |
| `STREAMING_EDIT_INTERVAL_MS` | 流式编辑间隔（毫秒） | `350` |
| `MAX_HISTORY_MESSAGES` | 单会话最大历史消息条数 | `32` |
| `MAX_CONTEXT_CHARS` | 发送给模型的历史上下文字符预算 | `48000` |
| `MAX_INPUT_CHARS` / `MAX_OUTPUT_CHARS` | 输入/输出字符上限 | `12000` / `3500` |
| `REQUEST_TIMEOUT_MS` | 请求超时（毫秒） | `120000` |
| `DATABASE_FILE` | SQLite 数据库文件 | `./data/bot-data.db` |
| `DATA_FILE` | 旧版 JSON 数据文件（首次启动可自动迁移） | `./data/bot-data.json` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` | 速率限制窗口与最大请求数 | `60000` / `12` |
| `DAILY_QUOTA` | 每用户每日配额 | `200` |
| `HEALTH_PORT` | 健康检查端口 | `3000` |
| `ADMIN_API_ENABLED` / `ADMIN_API_PORT` / `ADMIN_API_PREFIX` / `ADMIN_API_TOKEN` | 管理后台 API 开关、端口、路径前缀与访问令牌 | `true` / `3001` / `/admin/api/v1` / `your_secret_token` |
| `ADMIN_USER_IDS` | 管理员用户 ID，逗号分隔 | `123456789,987654321` |
| `ALLOWED_USER_IDS` / `ALLOWED_CHAT_IDS` | 允许使用的用户/群组 ID 白名单 | `123456789` / `-100987654321` |
| `BLOCKED_USER_IDS` | 封禁用户 ID 黑名单 | `111222333` |
| `GROUP_TRIGGER_MODE` | 默认群聊触发模式 | `smart` |
| `GROUP_TRIGGER_KEYWORD` | 默认群聊触发关键词 | `ai` |

## AI 提供商配置示例（重点）

本项目当前已支持以下原生 provider：
- `openai-compatible`（OpenAI / OpenRouter / 其他兼容网关）
- `anthropic`（Claude 官方 API）
- `gemini`（Google Gemini 官方 API）
- `gemini-live`（Google Gemini Live 原生音频 API）
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
AI_MODEL=gemini-3.5-flash
AI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash
ENABLE_GEMINI_GOOGLE_SEARCH=true
```

### 5) Qwen（通义千问）官方

```env
AI_PROVIDER=qwen
QWEN_API_KEY=sk-...
AI_MODEL=qwen-plus
```

### 6) Gemini Live 官方（原生音频对话/转写/TTS）

```env
AI_PROVIDER=gemini-live
GEMINI_LIVE_API_KEY=AIza...
AI_MODEL=gemini-2.5-flash-preview-native-audio-dialog
# 可选：语音专用模型，不填默认复用 AI_MODEL
GEMINI_LIVE_TRANSCRIPTION_MODEL=gemini-2.5-flash-preview-native-audio-dialog
GEMINI_LIVE_TTS_MODEL=gemini-2.5-flash-preview-native-audio-dialog
```

### 7) Grok（xAI）官方

```env
AI_PROVIDER=grok
GROK_API_KEY=xai-...
AI_MODEL=grok-3-mini-beta
```

### 8) DeepSeek 官方

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
AI_MODEL=deepseek-chat
```

### 9) 智谱 GLM 官方

```env
AI_PROVIDER=glm
GLM_API_KEY=...
AI_MODEL=glm-4-flash
```

### 10) 豆包（火山引擎 Ark）官方

```env
AI_PROVIDER=doubao
DOUBAO_API_KEY=...
AI_MODEL=doubao-seed-1-6-250615
```

> 注意：`AI_PROVIDER` 与密钥、模型必须是一组匹配配置，不能混用。
> 另外请使用 `AI_API_KEY` 变量名（不是 `OPENAI_API_KEY`）作为统一兜底密钥变量。

## 能力矩阵与降级策略

| Provider | 文本对话 | 工具调用 | 图片理解 | 图片生成 | 图片编辑 | 语音转文字 | 文字转语音 | Live Audio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai-compatible | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| anthropic | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| gemini | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| gemini-live | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| qwen | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| grok | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| deepseek | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| glm | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| doubao | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

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

## 部署与上线（Phase G 基线）

### 平台无关主流程（先做这个）

1. 准备环境变量最小集：
   - `BOT_TOKEN`
   - `AI_PROVIDER`
   - `AI_MODEL`
   - 平台密钥（`AI_API_KEY` 或对应原生平台专用 key）
2. 准备持久化路径：
   - 容器内统一使用 `DATABASE_FILE`（推荐：`/app/data/bot-data.db` 或 `/var/data/bot-data.db`）
3. 启动前检查：
   - 健康端口 `HEALTH_PORT=3000`
   - 管理端口 `ADMIN_API_PORT=3001`
   - 管理 API 令牌 `ADMIN_API_TOKEN` 已设置
4. 发布前执行：
   - PR 快速集：`npm run test:quick && npm run test:smoke`
   - 主干全量集：`npm run test:full`
   - 发布候选集：`npm run test:release`
5. 通过 `docs/release/phase-g-go-no-go.md` 做 Go/No-Go 决策。

### 两档部署模板

#### A) 最小可用（开发/验收）

```bash
docker compose up -d --build
```

- 使用 `docker-compose.yml`
- 默认挂载 `./data -> /app/data`
- 默认暴露 `3000`（健康）和 `3001`（管理 API）

#### B) 生产推荐（长期运行）

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

- 使用 `docker-compose.prod.yml`
- 端口仅绑定到 `127.0.0.1`
- 启用日志滚动与 `restart: always`

## 平台差异附录

### Railway

- 使用 `railway.json + Dockerfile`
- 建议变量：`AI_PROVIDER`、`AI_MODEL`、`DATABASE_FILE=/app/data/bot-data.db`
- 开启卷并挂载 `/app/data`

### Render

- 使用 `render.yaml`
- 已统一 `AI_PROVIDER`、`HEALTH_PORT`、`ADMIN_API_PORT`、`DATABASE_FILE=/var/data/bot-data.db`
- 持久化挂载目录 `/var/data`

### Zeabur

- 推荐 Dockerfile 部署；`zbpack.json` 作为节点构建回退模板
- 建议变量：`AI_PROVIDER`、`AI_MODEL`、`DATABASE_FILE=/app/data/bot-data.db`
- 挂载 `/app/data` 持久化卷

### VPS（Docker Compose）

```bash
cp .env.example .env
# 编辑 .env 填写 BOT_TOKEN / AI_PROVIDER / AI_MODEL / 密钥 / ADMIN_API_TOKEN
mkdir -p data

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
curl -fsS http://127.0.0.1:3000/
```

## 升级、回滚、备份恢复

### 升级

1. 拉取新版本代码
2. 执行发布候选集：`npm run test:release`
3. 重建并滚动启动容器

### 回滚

1. 切回上一个稳定版本
2. 使用相同 `.env` 与数据卷重启服务
3. 验证健康检查与管理 API 可访问

### 备份恢复（SQLite）

- 备份：复制 `DATABASE_FILE` 指向的 db 文件（例如 `data/bot-data.db`）
- 恢复：停服务后替换 db 文件并重启
- 如保留旧 JSON，`DATA_FILE` 可作为历史导入来源

## 常见故障排查

- `401/UNAUTHORIZED`：检查 `ADMIN_API_TOKEN`，并确认鉴权请求头格式是否正确
- `FORBIDDEN`：检查 `x-admin-user-id` 对应角色权限（RBAC）
- `DATABASE is locked`：确认单实例写入策略与持久化卷权限
- `invalid_api_key (401)`：检查 `AI_PROVIDER / AI_MODEL / API Key` 组合一致性
- `Dockerfile is required for arbitrary Git sources`：平台需手动指定 Dockerfile 路径与上下文

## 上线核对

- 发布门禁：`docs/release/phase-g-go-no-go.md`
- 全局复查：`docs/release/phase-g-refactor-review.md`
- CI 分级执行：`.github/workflows/phase-g-validation.yml`

## 测试

```bash
npm test
```

Phase G 分层测试命令：

- `npm run test:quick`：PR 快速集
- `npm run test:smoke`：发布前 smoke
- `npm run test:e2e`：端到端核心链路
- `npm run test:regression`：关键能力回归
- `npm run test:load`：负载基线
- `npm run test:fault`：故障注入
- `npm run test:full`：主干全量集
- `npm run test:release`：发布候选集（全量 + 负载 + 故障）

## Phase 1 架构变化

- 持久化层已切换为 SQLite
- `src/plugins/*-plugin.js` 会自动注册 `/web`、`/image`、`/tts` 等可扩展能力
- 聊天回复支持 Telegram 端渐进式流式输出

## 注意事项

- 图片理解支持多平台；`/tts`、语音转文字、`/image` 当前仅在 `openai-compatible` 提供商可用。
- URL 抓取和联网搜索依赖运行环境的外网访问能力。
- 当前文件解析已内置 txt / md / json / csv / xml / pdf / docx / xlsx 路由，超限会自动拒绝并提示拆分。
