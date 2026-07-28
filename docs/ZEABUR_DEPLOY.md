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

## Smart AI Router

Smart 任务路由默认开启；Zeabur 模板中的任务模型值故意留空，部署者应从自己的 Provider 或 AI Hub 控制台复制：

```env
SMART_ROUTING_ENABLED=true
SMART_ROUTING_DEBUG=false
SMART_ROUTING_MIN_CONFIDENCE=0.55
```

支持 `GENERAL`、`TRANSLATION`、`CODE`、`REASONING`、`LONG_CONTEXT`、`DOCUMENT`、`VISION`、`OCR`、`TOOL`、`CHEAP` 十类 `ROUTER_<TASK>_PROVIDER` / `ROUTER_<TASK>_MODEL` 配置。设置 `SMART_ROUTING_ENABLED=false` 可完全跳过 Smart 任务路由；置信度会安全限制在 `0` 到 `1`。

优先级是：用户明确模型 → 用户明确 Provider → 翻译、视觉/媒体等专用模式 → Smart 任务目标 → 默认 Provider / 模型 → 失败后原有备用链。Smart 路由不修改 `ENABLE_PROVIDER_FALLBACK`、同 Provider 备用模型或 `AI_PROVIDER_FALLBACK_ORDER`；专用模式需要时会绕过 Smart 路由。

`ENABLE_AI_ROUTER`、`ROUTER_PROVIDER` 和 `ROUTER_MODEL` 是原有的 LLM intent router，与 Smart AI Router 不是同一开关或同一组变量，旧行为保持不变。

当 `DEFAULT_AI_PROVIDER=auto` 时，每个非空 `ROUTER_*_MODEL` 都必须与具体的 `ROUTER_*_PROVIDER` 成对配置。当默认 Provider 固定且非 `auto` 时，任务 Provider 可以留空，所有任务模型会归入该固定 Provider。

### Zeabur AI Hub

把 AI Hub 当作标准 OpenAI-compatible Provider 使用，并填写 AI Hub 控制台实际提供的 Base URL；项目不硬编码 Zeabur AI Hub URL：

```env
DEFAULT_AI_PROVIDER=openai-compatible
AI_API_KEY=
AI_BASE_URL=
AI_MODEL=
```

这种固定 Provider 配置允许一个 `AI_API_KEY` / `AI_BASE_URL` 搭配多个 `ROUTER_*_MODEL`。如果继续使用 `DEFAULT_AI_PROVIDER=auto`，每个 Hub 任务模型都要同时写 `ROUTER_*_PROVIDER=openai-compatible`。

## Gemini Live 可选环境变量

GEMINI_LIVE_API_KEY=
GEMINI_LIVE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_LIVE_TRANSCRIPTION_MODEL=
GEMINI_LIVE_TTS_MODEL=
ENABLE_LIVE_AUDIO=false
ENABLE_LIVE_TRANSLATE=false

只有配置独立的 `GEMINI_LIVE_API_KEY` 和兼容模型后才开启这两个开关；普通 `GEMINI_API_KEY` 不会自动开放 Live 功能。Gemini Live 只走 Google 官方 Gemini Live API，不能把第三方 OpenAI-compatible 或 AI Hub 地址配置成 `gemini-live`；实时语音专用模式会按需绕过 Smart 路由。

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
