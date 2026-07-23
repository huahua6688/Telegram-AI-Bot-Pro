# Telegram-AI-Bot-Pro Zeabur 部署说明

## 部署方式

Zeabur 选择 GitHub 部署：

- 仓库：huahua6688/Telegram-AI-Bot-Pro
- 构建方式：Dockerfile
- 端口类型：HTTP
- 端口：8080

## Volume

如果使用 SQLite，建议创建 Volume：

- 卷名称：telegram-bot-data
- 挂载路径：/data

对应环境变量：

DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json

## 必填环境变量

BOT_TOKEN=
DEFAULT_AI_PROVIDER=auto
DEFAULT_AI_MODEL=gemini-2.5-flash
ENABLE_PROVIDER_FALLBACK=true
AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter
# 首次失败后的额外重试次数；1 表示每个模型最多尝试 2 次
AI_PROVIDER_MAX_RETRIES=1
ENABLE_GEMINI_GOOGLE_SEARCH=true
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite
DATABASE_FILE=/data/bot-data.db
PORT=8080
HEALTH_PORT=8080

真正跨平台回退还必须填写独立的 `GROQ_API_KEY` 或 `OPENROUTER_API_KEY`。若使用 OpenRouter 免费动态路由，设置 `OPENROUTER_MODEL=openrouter/free`。稳定实时搜索建议配置 `BRAVE_SEARCH_API_KEY`；免密搜索只作为尽力而为的回退。

## Gemini Live 可选环境变量

GEMINI_LIVE_API_KEY=
GEMINI_LIVE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_LIVE_TRANSCRIPTION_MODEL=
GEMINI_LIVE_TTS_MODEL=
ENABLE_LIVE_AUDIO=false
ENABLE_LIVE_TRANSLATE=false

只有配置独立的 `GEMINI_LIVE_API_KEY` 和兼容模型后才开启这两个开关；普通 `GEMINI_API_KEY` 不会自动开放 Live 功能。

## 常见错误

### BackOff / 容器反复重启

先看 Runtime Logs，重点检查：

- BOT_TOKEN 是否填写
- DEFAULT_AI_PROVIDER 是否正确
- DEFAULT_AI_MODEL 是否正确
- API Key 是否填写
- PORT / HEALTH_PORT 是否为 8080
- DATABASE_FILE 是否指向 /data

### pdf-parse 报错

ESM 项目里不要使用错误的 default import。当前使用：

import * as pdfParse from 'pdf-parse';

const { PDFParse } = pdfParse;

### 端口错误

Zeabur 会注入 PORT，代码必须读取 process.env.PORT，不要写死 3000。
