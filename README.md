# Telegram-AI-Bot-Pro

中文 | [English](#english)

## 一键复制 Zeabur 环境变量

先把下面整段复制到 Zeabur 的 Environment Variables。最少只需要改 3 个值：

- `BOT_TOKEN`: 从 Telegram [BotFather](https://t.me/BotFather) 获取
- `ADMIN_USER_IDS`: 给机器人发送 `/whoami` 后复制你的数字 ID
- `GEMINI_API_KEY`: 从 [Google AI Studio](https://aistudio.google.com/app/apikey) 获取

`OPENROUTER_API_KEY` 推荐填写。OpenRouter 免费模型通常带 `:free` 后缀，当前可用模型会变化；下面模板先放当前模型 API 里能看到的免费模型。`GROQ_API_KEY` 可选；Groq 官方页面列的是 Developer Plan 限额和价格，不是 `:free` 模型名。没有额度的平台先留空，不要乱填 Key。

常用入口：[BotFather](https://t.me/BotFather) / [Google AI Studio](https://aistudio.google.com/app/apikey) / [OpenRouter Keys](https://openrouter.ai/settings/keys) / [Groq Keys](https://console.groq.com/keys) / [OpenRouter Models](https://openrouter.ai/models) / [Groq Models](https://console.groq.com/docs/models)

在 GitHub 仓库首页，下面这个代码块右上角会有 **Copy** 按钮；点一下就能复制整段。

```env
# Required
BOT_TOKEN=
ADMIN_USER_IDS=

# Default AI behavior
DEFAULT_AI_PROVIDER=auto
DEFAULT_AI_MODEL=gemini-2.5-flash
ENABLE_USER_PROVIDER_SELECTION=true
ENABLE_USER_MODEL_SELECTION=true

# Automatic fallback
ENABLE_PROVIDER_FALLBACK=true
AI_PROVIDER_FALLBACK_ORDER=gemini,openrouter,groq
AI_PROVIDER_MAX_RETRIES=1
AI_PROVIDER_RETRY_DELAY_MS=800
AI_PROVIDER_COOLDOWN_MS=60000
MODEL_LIST_CACHE_TTL_MS=3600000

# Google Gemini free-tier first
GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite

# OpenRouter free models
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=tencent/hy3:free
OPENROUTER_FALLBACK_MODELS=poolside/laguna-xs-2.1:free,cohere/north-mini-code:free
OPENROUTER_HTTP_REFERER=
OPENROUTER_APP_TITLE=Telegram AI Bot Pro

# Groq optional fast fallback
GROQ_API_KEY=
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=llama-3.1-8b-instant
GROQ_FALLBACK_MODELS=openai/gpt-oss-20b,llama-3.3-70b-versatile

# Dedicated capability providers
TRANSLATION_PROVIDER=gemini
TRANSLATION_MODEL=gemini-3.1-flash-lite
ROUTER_PROVIDER=gemini
ROUTER_MODEL=gemini-3.1-flash-lite
MEMORY_PROVIDER=gemini
MEMORY_MODEL=gemini-3.1-flash-lite
VISION_PROVIDER=gemini
VISION_MODEL=gemini-2.5-flash
TRANSCRIPTION_PROVIDER=gemini-live
TRANSCRIPTION_MODEL=
TTS_PROVIDER=gemini-live
TTS_MODEL=
IMAGE_PROVIDER=openai-compatible
IMAGE_MODEL=

# Gemini Live optional
GEMINI_LIVE_API_KEY=
GEMINI_LIVE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_LIVE_MODEL=
GEMINI_LIVE_TRANSCRIPTION_MODEL=
GEMINI_LIVE_TTS_MODEL=
ENABLE_LIVE_AUDIO=false
ENABLE_LIVE_TRANSLATE=false

# Features
ENABLE_AI_ROUTER=false
AI_ROUTER_MODE=single-pass
ENABLE_MEMORY_SUMMARY=true
MEMORY_SUMMARY_INTERVAL=5
ENABLE_TOOL_CALLS=true
ENABLE_WEB_SEARCH=true
ENABLE_GEMINI_GOOGLE_SEARCH=true
ENABLE_URL_FETCH=true
ENABLE_STREAMING_REPLIES=true

# Limits
MAX_HISTORY_MESSAGES=32
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=12
DAILY_QUOTA=200

# Storage / Zeabur
DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json
PORT=8080
HEALTH_PORT=8080

# Admin API
ADMIN_API_ENABLED=false
ADMIN_API_TOKEN=

# Legacy compatibility. Keep blank unless you still use the old single-provider config.
AI_PROVIDER=
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=
AI_FALLBACK_MODELS=
```

## 没填的写什么

| 变量 | 要不要填 | 怎么填 |
| --- | --- | --- |
| `BOT_TOKEN` | 必填 | 填 BotFather 给你的 Telegram Bot Token |
| `ADMIN_USER_IDS` | 建议填 | 给机器人发 `/whoami`，复制数字 ID；多个管理员用英文逗号分隔 |
| `GEMINI_API_KEY` | 必填 | 填 Google AI Studio 的 API Key |
| `OPENROUTER_API_KEY` | 强烈建议 | 填 OpenRouter Key，用来走 `:free` 免费备用模型 |
| `GROQ_API_KEY` | 可选 | 有 Groq Key 就填，没有就留空 |
| `GEMINI_LIVE_API_KEY` | 可选 | 暂时不用实时语音就留空 |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_FALLBACK_MODELS` | 留空 | 这是旧配置兼容位，留空可以避免干扰 `DEFAULT_AI_PROVIDER=auto` |
| `ADMIN_API_TOKEN` | 通常留空 | 只有 `ADMIN_API_ENABLED=true` 时才需要填 |
| `IMAGE_MODEL` | 先留空 | 没有图片生成额度就不要填 |
| Claude / OpenAI / DeepSeek / Qwen / Grok / GLM / Doubao 等 Key | 先不要填 | 没确认账号额度前都留空，否则后台测试会出现一堆失败 |

## 免费模型怎么填

现在最省心的免费优先组合是：

| Provider | 推荐模型 ID | 说明 |
| --- | --- | --- |
| Gemini | `gemini-2.5-flash` | Google 官方价格页显示 Free Tier 输入和输出免费 |
| Gemini 备用 | `gemini-2.5-flash-lite` | 免费层、限流和地区可能变化；如果控制台明确支持其他模型，再手动加入 |
| OpenRouter | `tencent/hy3:free` | 当前 OpenRouter API 中显示为 `prompt=0`、`completion=0` 的免费模型 |
| OpenRouter 备用 | `poolside/laguna-xs-2.1:free`, `cohere/north-mini-code:free` | 带 `:free` 的模型更适合做备用；免费模型可能会过期或下线 |
| Groq | `llama-3.1-8b-instant` | 官方列为 Developer Plan 模型，有限额和价格，是否可用取决于账号 |

官方页面：

- Gemini 价格和免费层：[Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- OpenRouter 模型 API：[OpenRouter models](https://openrouter.ai/api/v1/models)
- Groq 模型列表：[Groq supported models](https://console.groq.com/docs/models)

## 不要乱填这些平台

Claude、OpenAI、DeepSeek、Qwen、Grok、GLM、Doubao、Mistral、Hugging Face、GitHub Models 都已经在代码里支持，但它们不一定有长期免费额度。没有确认账号能调用之前，请保持对应的 `*_API_KEY` 和 `*_MODEL` 为空。否则后台测试会显示认证失败、额度不足或模型不存在。

| Provider ID | 平台 | Key 位置 | 模型名从哪里复制 |
| --- | --- | --- | --- |
| `gemini` | Google Gemini | [Google AI Studio](https://aistudio.google.com/app/apikey) | [Gemini 文档](https://ai.google.dev/gemini-api/docs/models) |
| `openrouter` | OpenRouter | [OpenRouter Keys](https://openrouter.ai/settings/keys) | [OpenRouter Models](https://openrouter.ai/models) |
| `groq` | Groq | [Groq Keys](https://console.groq.com/keys) | [Groq Models](https://console.groq.com/docs/models) |
| `github-models` | GitHub Models | [GitHub Models](https://github.com/marketplace/models) | [GitHub Models 文档](https://docs.github.com/en/github-models) |
| `huggingface` | Hugging Face | [HF Tokens](https://huggingface.co/settings/tokens) | [Hugging Face Models](https://huggingface.co/models) |
| `mistral` | Mistral AI | [Mistral Console](https://console.mistral.ai/api-keys/) | [Mistral Models](https://docs.mistral.ai/getting-started/models/) |
| `openai` | OpenAI | [OpenAI API Keys](https://platform.openai.com/api-keys) | [OpenAI Models](https://platform.openai.com/docs/models) |
| `anthropic` | Claude | [Claude Console](https://console.anthropic.com/settings/keys) | [Anthropic Models](https://docs.anthropic.com/en/docs/about-claude/models) |
| `deepseek` | DeepSeek | [DeepSeek Platform](https://platform.deepseek.com/api_keys) | [DeepSeek Models](https://api-docs.deepseek.com/quick_start/pricing) |
| `qwen` | Qwen | [阿里云百炼](https://bailian.console.aliyun.com/?apiKey=1) | 百炼控制台 |
| `grok` | xAI Grok | [xAI Console](https://console.x.ai/) | [xAI Docs](https://docs.x.ai/docs/models) |
| `glm` | 智谱 GLM | [BigModel API Keys](https://open.bigmodel.cn/usercenter/apikeys) | [智谱文档](https://docs.bigmodel.cn/cn/guide/models) |
| `doubao` | 豆包 / 火山方舟 | [Volcengine Ark](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) | [火山方舟模型列表](https://www.volcengine.com/docs/82379/1330310) |

## 机器人怎么用

默认菜单已经尽量简化。普通用户不需要点很多功能按钮，直接发送内容即可：

- 发文字：自动聊天、翻译、搜索、写作或问答
- 发图片：自动识别图片内容；如果文字里要求生成或修改图片，会走图片能力
- 发语音：自动转写并继续对话
- 发文件：自动读取并总结支持的文件
- 发链接：自动抓取网页并总结

如果要切换 Provider 或模型，进入 `设置 -> 模型`。选择会保存到 SQLite，重启后仍然有效。

## 自动切换说明

自动切换需要同时满足：

- `ENABLE_PROVIDER_FALLBACK=true`
- `AI_PROVIDER_FALLBACK_ORDER` 里写了备用顺序
- 备用平台有 API Key
- 备用平台有可用模型 ID

例如只填 Gemini，不填 OpenRouter 和 Groq，Gemini 额度用完后机器人不能凭空切到 OpenRouter。它会提示你配置备用 Provider。

## 部署和检查

Zeabur 推荐：

- `PORT=8080`
- `HEALTH_PORT=8080`
- `DATABASE_FILE=/data/bot-data.db`
- `DATA_FILE=/data/bot-data.json`
- 给服务挂载 `/data` 持久化目录

本地运行：

```bash
npm install
npm start
```

检查：

```bash
npm run doctor
npm run verify
```

## 常见错误

- `not configured`: 代码支持这个 Provider，但没有填 API Key 或模型 ID
- `401 invalid x-api-key`: Key 错了、过期了、复制错了，或填到了错误平台
- `403`: 账号、地区、权限或额度限制
- `404`: 模型 ID 写错或模型已下线
- `429`: 限流或免费额度用完
- Zeabur `BackOff`: 先检查 `BOT_TOKEN`、`PORT=8080`、`DATABASE_FILE=/data/bot-data.db`

## Telegram Mini App

- BotFather 已配置网址时无需重复设置；默认入口为 `https://你的域名/app`。
- Mini App 只用于 Provider/模型、人格、语言、聊天历史和管理员功能；聊天、联网搜索、翻译、图片、文件和语音继续直接在 Telegram 对话中使用。
- Telegram 命令菜单只保留 `/start`、`/help`、`/whoami`；Mini App 使用 BotFather 已配置的输入框左侧菜单按钮打开。
- Mini App 菜单按钮和网址由 BotFather 管理，程序不会重复修改。
- 输入框左侧入口名称保持为你在 BotFather 设置的“控制台”；联网搜索、翻译、图片、语音、文件、链接和记忆操作由自然语言或消息类型自动识别，不在 `/start`、`/help` 或工具箱重复显示按钮。
- 输入框下方只保留 App 没有、也不能安全自动开启的 `🔒 隐私聊天` 按钮；普通 AI 回复不重复附加功能按钮，数据库内容加密实现保持独立。

## Telegram 平台扩展模式

`/help` 回复下方提供 5 个真正可用的 Telegram 模式入口；`/whoami` 只显示 ID，不再附带这些功能按钮：

- **Inline Mode**：在任意聊天输入 `@机器人用户名 问题`，生成一条可直接发送的 AI 答案。
- **Guest Chat Mode**：无需把 Bot 加入聊天，@提及或回复后进行一次性回答。
- **Guard Mode**：处理入群请求；黑名单拒绝、白名单/管理员通过，其余默认交管理员审核。
- **Secretary Mode**：通过 Telegram Business/Secretary 连接处理授权聊天，并在有权限时代表账号回复。
- **Bot-to-Bot Communication**：其他 Bot 可用 `/ask@本机器人 问题` 或直接回复本 Bot；内置去重、限速和单轮终止保护。

代码部署后，还需要在 BotFather 的 Bot Settings 中为当前 Bot 开启对应平台模式。按钮详情页会根据 `getMe` 返回值显示 Inline、Guest、Guard、Secretary 的实际启用状态。访客、Inline 和 Secretary 的第三方消息不写入普通聊天记录或长期记忆。

## English

## One-Copy Zeabur Environment Variables

Copy this whole block into Zeabur Environment Variables. At minimum, fill:

- `BOT_TOKEN`: from Telegram [BotFather](https://t.me/BotFather)
- `ADMIN_USER_IDS`: send `/whoami` to the bot and copy your numeric ID
- `GEMINI_API_KEY`: from [Google AI Studio](https://aistudio.google.com/app/apikey)

`OPENROUTER_API_KEY` is recommended. OpenRouter free models usually have a `:free` suffix, and availability changes over time. The template below uses free model IDs currently visible in the OpenRouter models API. `GROQ_API_KEY` is optional. Leave other provider keys blank unless you know your account has quota.

Quick links: [BotFather](https://t.me/BotFather) / [Google AI Studio](https://aistudio.google.com/app/apikey) / [OpenRouter Keys](https://openrouter.ai/settings/keys) / [Groq Keys](https://console.groq.com/keys) / [OpenRouter Models](https://openrouter.ai/models) / [Groq Models](https://console.groq.com/docs/models)

On the GitHub repository homepage, the code block below has a built-in **Copy** button in the upper-right corner.

```env
# Required
BOT_TOKEN=
ADMIN_USER_IDS=

# Default AI behavior
DEFAULT_AI_PROVIDER=auto
DEFAULT_AI_MODEL=gemini-2.5-flash
ENABLE_USER_PROVIDER_SELECTION=true
ENABLE_USER_MODEL_SELECTION=true

# Automatic fallback
ENABLE_PROVIDER_FALLBACK=true
AI_PROVIDER_FALLBACK_ORDER=gemini,openrouter,groq
AI_PROVIDER_MAX_RETRIES=1
AI_PROVIDER_RETRY_DELAY_MS=800
AI_PROVIDER_COOLDOWN_MS=60000
MODEL_LIST_CACHE_TTL_MS=3600000

# Google Gemini free-tier first
GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite

# OpenRouter free models
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=tencent/hy3:free
OPENROUTER_FALLBACK_MODELS=poolside/laguna-xs-2.1:free,cohere/north-mini-code:free
OPENROUTER_HTTP_REFERER=
OPENROUTER_APP_TITLE=Telegram AI Bot Pro

# Groq optional fast fallback
GROQ_API_KEY=
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=llama-3.1-8b-instant
GROQ_FALLBACK_MODELS=openai/gpt-oss-20b,llama-3.3-70b-versatile

# Dedicated capability providers
TRANSLATION_PROVIDER=gemini
TRANSLATION_MODEL=gemini-3.1-flash-lite
ROUTER_PROVIDER=gemini
ROUTER_MODEL=gemini-3.1-flash-lite
MEMORY_PROVIDER=gemini
MEMORY_MODEL=gemini-3.1-flash-lite
VISION_PROVIDER=gemini
VISION_MODEL=gemini-2.5-flash
TRANSCRIPTION_PROVIDER=gemini-live
TRANSCRIPTION_MODEL=
TTS_PROVIDER=gemini-live
TTS_MODEL=
IMAGE_PROVIDER=openai-compatible
IMAGE_MODEL=

# Gemini Live optional
GEMINI_LIVE_API_KEY=
GEMINI_LIVE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_LIVE_MODEL=
GEMINI_LIVE_TRANSCRIPTION_MODEL=
GEMINI_LIVE_TTS_MODEL=
ENABLE_LIVE_AUDIO=false
ENABLE_LIVE_TRANSLATE=false

# Features
ENABLE_AI_ROUTER=false
AI_ROUTER_MODE=single-pass
ENABLE_MEMORY_SUMMARY=true
MEMORY_SUMMARY_INTERVAL=5
ENABLE_TOOL_CALLS=true
ENABLE_WEB_SEARCH=true
ENABLE_GEMINI_GOOGLE_SEARCH=true
ENABLE_URL_FETCH=true
ENABLE_STREAMING_REPLIES=true

# Limits
MAX_HISTORY_MESSAGES=32
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=12
DAILY_QUOTA=200

# Storage / Zeabur
DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json
PORT=8080
HEALTH_PORT=8080

# Admin API
ADMIN_API_ENABLED=false
ADMIN_API_TOKEN=

# Legacy compatibility. Keep blank unless you still use the old single-provider config.
AI_PROVIDER=
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=
AI_FALLBACK_MODELS=
```

## What To Fill

| Variable | Required? | Value |
| --- | --- | --- |
| `BOT_TOKEN` | Required | Your Telegram BotFather token |
| `ADMIN_USER_IDS` | Recommended | Send `/whoami` to the bot and copy the numeric ID; separate multiple IDs with commas |
| `GEMINI_API_KEY` | Required | Your Google AI Studio API key |
| `OPENROUTER_API_KEY` | Strongly recommended | Your OpenRouter key for `:free` fallback models |
| `GROQ_API_KEY` | Optional | Fill it only if you have a Groq key |
| `GEMINI_LIVE_API_KEY` | Optional | Leave blank unless you use live audio |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_FALLBACK_MODELS` | Leave blank | Legacy compatibility fields; blank avoids overriding `DEFAULT_AI_PROVIDER=auto` |
| `ADMIN_API_TOKEN` | Usually blank | Required only when `ADMIN_API_ENABLED=true` |
| `IMAGE_MODEL` | Leave blank first | Fill only when you have image generation quota |
| Claude / OpenAI / DeepSeek / Qwen / Grok / GLM / Doubao keys | Leave blank first | Configure only after confirming account quota |

## Free Model Names

| Provider | Recommended model ID | Notes |
| --- | --- | --- |
| Gemini | `gemini-2.5-flash` | Google pricing lists free input/output on the Free Tier |
| Gemini fallback | `gemini-2.5-flash-lite` | Free tiers and limits can change; add other models only after confirming access in the console |
| OpenRouter | `tencent/hy3:free` | Currently listed by OpenRouter with `prompt=0` and `completion=0` |
| OpenRouter fallback | `poolside/laguna-xs-2.1:free`, `cohere/north-mini-code:free` | Useful explicit free fallbacks; free models may expire or disappear |
| Groq | `llama-3.1-8b-instant` | Developer Plan model; availability depends on your account |

Official references:

- [Gemini Developer API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [OpenRouter models API](https://openrouter.ai/api/v1/models)
- [Groq supported models](https://console.groq.com/docs/models)

## Use The Bot

Users can send content directly:

- Text: chat, translation, search, writing, and Q&A
- Photos: image understanding, and inferred image generation/editing
- Voice: transcription and follow-up chat
- Files: parsing and summarization
- Links: webpage fetch and summary

To switch provider or model, open `Settings -> Model`. User choices are stored in SQLite and survive restarts.

## Safety

- Never commit `.env`
- Never paste API keys into Telegram chats
- Keep unused paid providers blank
- Verify current model IDs in provider dashboards before deployment
