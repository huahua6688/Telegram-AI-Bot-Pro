# Telegram-AI-Bot-Pro

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

## 测试

```bash
npm test
```

## 注意事项

- 图片理解、TTS、语音转文字、图片生成依赖你的 AI 服务是否兼容相应 OpenAI 接口。
- URL 抓取和联网搜索依赖运行环境的外网访问能力。
- 当前文本文件解析优先支持 txt / md / json / csv / xml 等文本类文件。
