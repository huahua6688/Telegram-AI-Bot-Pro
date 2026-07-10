# Telegram-AI-Bot-Pro

中文 | [English](#english)

一个可部署到 Zeabur、Railway、Render、VPS 的 Telegram AI Bot。项目基于 Node.js + Telegraf，支持多 AI Provider、用户独立模型选择、自动故障转移、图片理解、语音处理、文件总结、联网搜索、管理员控制和 SQLite 持久化。

## 中文

### 主要功能

- 多轮 Telegram 私聊和群聊
- Telegram 内联按钮切换 AI Provider 和模型
- 每个用户独立保存 Provider、模型和自动备用设置
- 跨 Provider 自动故障转移，支持重试、冷却和错误分类
- Gemini 与 Gemini Live 分离：普通聊天走 Gemini，语音/Live 能力走 Gemini Live
- 图片理解、语音转文字、文字转语音、图片生成/编辑、文件解析和总结
- 联网搜索、URL 抓取、工具调用、人格/语言/记忆设置
- 管理员菜单、用量限制、allow/block 控制、健康检查
- SQLite 数据库，适合 Zeabur `/data` 持久化部署

### 已支持的 Provider

| Provider ID | 平台 | 主要环境变量 | 说明 |
| --- | --- | --- | --- |
| `gemini` | Google Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | 推荐主力 Provider，适合文字、图片理解和多模态 |
| `gemini-live` | Google Gemini Live | `GEMINI_LIVE_API_KEY`, `GEMINI_LIVE_MODEL` | 与普通 Gemini 分开，用于语音、TTS、未来实时 Live |
| `groq` | Groq | `GROQ_API_KEY`, `GROQ_MODEL` | OpenAI-compatible，适合高速文本备用 |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | 一个 API 调多个模型，适合备用和免费模型 |
| `github-models` | GitHub Models | `GITHUB_MODELS_API_KEY`, `GITHUB_MODELS_MODEL` | 适合开发测试和多模型体验 |
| `huggingface` | Hugging Face | `HUGGINGFACE_API_KEY`, `HUGGINGFACE_MODEL` | 适合开源模型和实验 |
| `mistral` | Mistral AI | `MISTRAL_API_KEY`, `MISTRAL_MODEL` | Mistral 官方 API |
| `openai` | OpenAI 官方 API | `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI 官方平台 |
| `openai-compatible` | 自定义 OpenAI-compatible 网关 | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | 也可接第三方兼容网关 |
| `anthropic` | Anthropic Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude 官方 API |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | DeepSeek 官方 API |
| `qwen` | 阿里云百炼 / Qwen | `QWEN_API_KEY`, `QWEN_MODEL` | 通义千问兼容接口 |
| `grok` | xAI Grok | `GROK_API_KEY`, `GROK_MODEL` | xAI 官方 API |
| `glm` | 智谱 GLM | `GLM_API_KEY`, `GLM_MODEL` | 智谱开放平台 |
| `doubao` | 火山方舟 / 豆包 | `DOUBAO_API_KEY`, `DOUBAO_MODEL` | Volcengine Ark API |

没有填写 Key 或模型的 Provider 会显示为 `not configured`，机器人会跳过它，不会因为可选 Provider 未配置而崩溃。

### 你的环境变量还缺什么

你现在给出的配置可以继续兼容旧版 `AI_PROVIDER=gemini` / `AI_MODEL=...`，但新架构建议补下面这些变量：

```env
DEFAULT_AI_PROVIDER=gemini
DEFAULT_AI_MODEL=从控制台复制的模型ID

ENABLE_USER_PROVIDER_SELECTION=true
ENABLE_USER_MODEL_SELECTION=true

ENABLE_PROVIDER_FALLBACK=true
AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter
AI_PROVIDER_MAX_RETRIES=1
AI_PROVIDER_RETRY_DELAY_MS=800
AI_PROVIDER_COOLDOWN_MS=60000
MODEL_LIST_CACHE_TTL_MS=3600000

GEMINI_MODEL=从 Google AI Studio 复制
GEMINI_FALLBACK_MODELS=

GROQ_API_KEY=
GROQ_MODEL=

OPENROUTER_API_KEY=
OPENROUTER_MODEL=
OPENROUTER_HTTP_REFERER=
OPENROUTER_APP_TITLE=Telegram AI Bot Pro

TRANSLATION_PROVIDER=gemini
ROUTER_PROVIDER=gemini
MEMORY_PROVIDER=gemini
VISION_PROVIDER=gemini
TRANSCRIPTION_PROVIDER=gemini-live
TTS_PROVIDER=gemini-live
IMAGE_PROVIDER=openai-compatible

ADMIN_API_TOKEN=
```

`PASSWORD` 不是这个项目当前使用的变量；如果只是 Zeabur 里遗留的变量，可以不填或删除。后台 API 用的是 `ADMIN_API_TOKEN`。

### 去哪里拿 API Key

| 平台 | 获取 Key / 控制台 | 模型 ID 从哪里复制 |
| --- | --- | --- |
| Telegram Bot Token | [BotFather](https://t.me/BotFather) / [Telegram Bot 教程](https://core.telegram.org/bots/tutorial) | 不需要模型 ID |
| Google Gemini / Gemini Live | [Google AI Studio API Keys](https://aistudio.google.com/app/apikey) / [Gemini API Key 文档](https://ai.google.dev/gemini-api/docs/api-key) | Google AI Studio 的模型列表 |
| Groq | [Groq API Keys](https://console.groq.com/keys) / [Groq Quickstart](https://console.groq.com/docs/quickstart) | Groq Console 的 Models 页面 |
| OpenRouter | [OpenRouter Keys](https://openrouter.ai/settings/keys) / [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart) | OpenRouter Models 页面，免费模型通常带 `:free` |
| GitHub Models | [GitHub Models](https://github.com/marketplace/models) / [GitHub Models 文档](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models) | GitHub Models 页面 |
| Hugging Face | [HF Access Tokens](https://huggingface.co/settings/tokens) / [HF Token 文档](https://huggingface.co/docs/hub/security-tokens) | Hugging Face 模型或 Inference Providers 页面 |
| Mistral | [Mistral Console](https://console.mistral.ai/api-keys/) / [Mistral Docs](https://docs.mistral.ai/) | Mistral Console / Docs 的模型列表 |
| OpenAI | [OpenAI API Keys](https://platform.openai.com/api-keys) / [OpenAI Quickstart](https://platform.openai.com/docs/quickstart) | OpenAI Models 页面 |
| Anthropic Claude | [Claude Console](https://console.anthropic.com/settings/keys) / [Anthropic API Docs](https://docs.anthropic.com/en/api/getting-started) | Anthropic Console / Docs |
| DeepSeek | [DeepSeek API Keys](https://platform.deepseek.com/api_keys) / [DeepSeek Docs](https://api-docs.deepseek.com/) | DeepSeek 模型与价格页 |
| Qwen / 阿里云百炼 | [百炼 API Key](https://bailian.console.aliyun.com/?apiKey=1) / [阿里云获取 API Key 文档](https://help.aliyun.com/zh/model-studio/get-api-key) | 百炼控制台模型页面 |
| Grok / xAI | [xAI Console](https://console.x.ai/) / [xAI Quickstart](https://docs.x.ai/docs/quickstart) | xAI Console 模型页面 |
| GLM / 智谱 | [智谱 API Keys](https://open.bigmodel.cn/usercenter/apikeys) / [智谱文档](https://docs.bigmodel.cn/cn/guide/start/introduction) | 智谱开放平台模型页面 |
| Doubao / 火山方舟 | [火山方舟控制台](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) / [火山方舟文档](https://www.volcengine.com/docs/82379/1399008) | 火山方舟模型列表 |

模型名、免费额度、限流和可用地区会变化。不要照抄旧教程里的模型名，应该从官方控制台复制当前可用的完整模型 ID。

### Zeabur 最小可用配置

只用 Gemini 先跑起来：

```env
BOT_TOKEN=你的 Telegram Bot Token
ADMIN_USER_IDS=你的 Telegram 数字 ID

DEFAULT_AI_PROVIDER=gemini
DEFAULT_AI_MODEL=从 Google AI Studio 复制
GEMINI_API_KEY=你的 Gemini API Key
GEMINI_MODEL=从 Google AI Studio 复制

DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json
PORT=8080
HEALTH_PORT=8080
```

加入 Groq 和 OpenRouter 作为自动备用：

```env
ENABLE_PROVIDER_FALLBACK=true
AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter

GROQ_API_KEY=你的 Groq Key
GROQ_MODEL=从 Groq Console 复制

OPENROUTER_API_KEY=你的 OpenRouter Key
OPENROUTER_MODEL=从 OpenRouter Models 复制
OPENROUTER_HTTP_REFERER=
OPENROUTER_APP_TITLE=Telegram AI Bot Pro
```

### 完整 Provider 环境变量模板

只填你要启用的平台。没填的平台会自动跳过。

```env
# Google Gemini
GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=
GEMINI_FALLBACK_MODELS=

# Gemini Live
GEMINI_LIVE_API_KEY=
GEMINI_LIVE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_LIVE_MODEL=
GEMINI_LIVE_TRANSCRIPTION_MODEL=
GEMINI_LIVE_TTS_MODEL=

# Groq
GROQ_API_KEY=
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=
GROQ_FALLBACK_MODELS=

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=
OPENROUTER_FALLBACK_MODELS=
OPENROUTER_HTTP_REFERER=
OPENROUTER_APP_TITLE=Telegram AI Bot Pro

# GitHub Models
GITHUB_MODELS_API_KEY=
GITHUB_MODELS_BASE_URL=https://models.github.ai/inference
GITHUB_MODELS_MODEL=
GITHUB_MODELS_FALLBACK_MODELS=

# Hugging Face
HUGGINGFACE_API_KEY=
HUGGINGFACE_BASE_URL=https://router.huggingface.co/v1
HUGGINGFACE_MODEL=
HUGGINGFACE_FALLBACK_MODELS=

# Mistral
MISTRAL_API_KEY=
MISTRAL_BASE_URL=https://api.mistral.ai/v1
MISTRAL_MODEL=
MISTRAL_FALLBACK_MODELS=

# OpenAI
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=
OPENAI_FALLBACK_MODELS=

# Custom OpenAI-compatible gateway
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=
AI_FALLBACK_MODELS=

# Anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_API_VERSION=2023-06-01
ANTHROPIC_MODEL=
ANTHROPIC_FALLBACK_MODELS=

# DeepSeek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=
DEEPSEEK_FALLBACK_MODELS=

# Qwen
QWEN_API_KEY=
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=
QWEN_FALLBACK_MODELS=

# Grok
GROK_API_KEY=
GROK_BASE_URL=https://api.x.ai/v1
GROK_MODEL=
GROK_FALLBACK_MODELS=

# GLM
GLM_API_KEY=
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=
GLM_FALLBACK_MODELS=

# Doubao
DOUBAO_API_KEY=
DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_MODEL=
DOUBAO_FALLBACK_MODELS=
```

### 专用能力 Provider

用户聊天选择 Groq 时，图片、语音、翻译仍然可以走更合适的 Provider：

```env
TRANSLATION_PROVIDER=gemini
TRANSLATION_MODEL=
ROUTER_PROVIDER=gemini
ROUTER_MODEL=
MEMORY_PROVIDER=gemini
MEMORY_MODEL=
VISION_PROVIDER=gemini
VISION_MODEL=
TRANSCRIPTION_PROVIDER=gemini-live
TRANSCRIPTION_MODEL=
TTS_PROVIDER=gemini-live
TTS_MODEL=
IMAGE_PROVIDER=openai-compatible
IMAGE_MODEL=gpt-image-1
IMAGE_SIZE=1024x1024
TTS_VOICE=alloy
```

### Telegram 怎么用

默认主菜单只保留少量入口：

- 帮助
- 设置
- 管理
- 关闭

普通用户不需要找功能按钮。直接发送内容即可：

- 发文字：普通聊天、翻译、搜索、写作、问答会自动判断
- 发图片：自动识别图片内容；如果文字里说明“生成图片/改图”，会走图片能力
- 发语音：自动转写并继续对话
- 发文件：自动读取并总结支持的文件
- 发链接：自动抓取网页并总结

如果要切换 Provider 或模型，进入 `设置 -> 模型`。模型按钮使用短索引 callback，不会超过 Telegram 64 字节限制。用户选择会保存到 SQLite，重启后仍然有效。

### 自动故障转移

启用：

```env
ENABLE_PROVIDER_FALLBACK=true
AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter
```

当当前 Provider 出现 401、403、404、408、429、5xx、网络错误、JSON 解析错误、空结果或能力不支持时，机器人会：

1. 判断错误类型
2. 按配置重试
3. 对失败 Provider 设置短冷却
4. 切换到下一个已配置且支持该能力的 Provider
5. 不把 API Key 或内部请求头发给用户

### Gemini 和 Gemini Live 的区别

- `gemini`：普通文字聊天、图片理解、多模态分析
- `gemini-live`：语音输入、语音输出、Live/实时语音预留

Telegram Bot 当前至少支持“用户发语音 -> 转写 -> AI 回复”。真正连续双向实时语音更适合通过 Telegram Web App 或独立 WebSocket 前端继续扩展。

### 本地运行

```bash
npm install
npm start
```

开发模式：

```bash
npm run dev
```

检查配置：

```bash
npm run doctor
```

测试：

```bash
npm run verify
npm run test:full
```

### 常见问题

- `not configured`：代码支持该 Provider，但没有填 API Key 或模型 ID。
- `401`：Key 错误、过期，或填到了错误的 Provider。
- `403`：账号权限、地区、模型权限或额度限制。
- `404`：模型 ID 写错或模型已下线。
- `429`：限流或免费额度用完，可以依赖自动备用切到其他 Provider。
- Zeabur `BackOff`：优先检查 `BOT_TOKEN`、`PORT=8080`、`DATABASE_FILE=/data/bot-data.db`。
- 重启后数据丢失：Zeabur 需要挂载 `/data` 持久化存储。

### 安全提醒

- 不要提交 `.env`
- 不要把 API Key 写进代码或 Telegram 消息
- 管理员 ID 用 `/whoami` 获取
- `ADMIN_API_ENABLED=true` 时必须设置 `ADMIN_API_TOKEN`
- 免费模型和额度会变，部署前先在对应控制台确认

---

## English

Telegram-AI-Bot-Pro is a deployable Telegram AI bot built with Node.js and Telegraf. It supports multiple AI providers, per-user model selection, cross-provider fallback, multimodal features, web tools, admin controls, and SQLite persistence.

### Features

- Multi-turn Telegram private and group chat
- Inline Telegram buttons for provider/model switching
- Per-user provider, model, and fallback preferences
- Cross-provider fallback with retry, cooldown, and error classification
- Separate Gemini and Gemini Live providers
- Image understanding, speech transcription, text-to-speech, image generation/editing, document parsing, and summarization
- Web search, URL fetch, tool calling, personas, language settings, and memory
- Admin menu, quotas, allow/block lists, and health checks
- SQLite storage suitable for Zeabur `/data` persistence

### Supported Providers

| Provider ID | Platform | Main env vars | Notes |
| --- | --- | --- | --- |
| `gemini` | Google Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | Recommended default for text, vision, and multimodal chat |
| `gemini-live` | Google Gemini Live | `GEMINI_LIVE_API_KEY`, `GEMINI_LIVE_MODEL` | Kept separate for speech, TTS, and future live audio |
| `groq` | Groq | `GROQ_API_KEY`, `GROQ_MODEL` | Fast OpenAI-compatible text fallback |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Multi-model gateway and fallback option |
| `github-models` | GitHub Models | `GITHUB_MODELS_API_KEY`, `GITHUB_MODELS_MODEL` | Useful for development and testing |
| `huggingface` | Hugging Face | `HUGGINGFACE_API_KEY`, `HUGGINGFACE_MODEL` | Open models and experiments |
| `mistral` | Mistral AI | `MISTRAL_API_KEY`, `MISTRAL_MODEL` | Official Mistral API |
| `openai` | OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | Official OpenAI API |
| `openai-compatible` | Custom OpenAI-compatible gateway | `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | Generic gateway support |
| `anthropic` | Anthropic Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Official Claude API |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | Official DeepSeek API |
| `qwen` | Alibaba Cloud Model Studio / Qwen | `QWEN_API_KEY`, `QWEN_MODEL` | OpenAI-compatible Qwen endpoint |
| `grok` | xAI Grok | `GROK_API_KEY`, `GROK_MODEL` | Official xAI API |
| `glm` | Zhipu GLM | `GLM_API_KEY`, `GLM_MODEL` | Zhipu AI platform |
| `doubao` | Volcengine Ark / Doubao | `DOUBAO_API_KEY`, `DOUBAO_MODEL` | Volcengine Ark API |

Unconfigured optional providers are skipped safely.

### Minimum Zeabur Config

```env
BOT_TOKEN=your_Telegram_BotFather_token
ADMIN_USER_IDS=your_Telegram_numeric_user_id

DEFAULT_AI_PROVIDER=gemini
DEFAULT_AI_MODEL=copy_from_google_ai_studio
GEMINI_API_KEY=your_Gemini_key
GEMINI_MODEL=copy_from_google_ai_studio

DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json
PORT=8080
HEALTH_PORT=8080
```

Add Groq and OpenRouter as fallbacks:

```env
ENABLE_PROVIDER_FALLBACK=true
AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter

GROQ_API_KEY=your_Groq_key
GROQ_MODEL=copy_from_Groq_console

OPENROUTER_API_KEY=your_OpenRouter_key
OPENROUTER_MODEL=copy_from_OpenRouter_models
OPENROUTER_APP_TITLE=Telegram AI Bot Pro
```

### Where To Get Keys

Use the official consoles:

- Telegram: [BotFather](https://t.me/BotFather)
- Gemini / Gemini Live: [Google AI Studio](https://aistudio.google.com/app/apikey)
- Groq: [Groq Console](https://console.groq.com/keys)
- OpenRouter: [OpenRouter Keys](https://openrouter.ai/settings/keys)
- GitHub Models: [GitHub Models](https://github.com/marketplace/models)
- Hugging Face: [HF Tokens](https://huggingface.co/settings/tokens)
- Mistral: [Mistral Console](https://console.mistral.ai/api-keys/)
- OpenAI: [OpenAI API Keys](https://platform.openai.com/api-keys)
- Anthropic: [Claude Console](https://console.anthropic.com/settings/keys)
- DeepSeek: [DeepSeek Platform](https://platform.deepseek.com/api_keys)
- Qwen: [Alibaba Cloud Model Studio](https://bailian.console.aliyun.com/?apiKey=1)
- Grok: [xAI Console](https://console.x.ai/)
- GLM: [BigModel API Keys](https://open.bigmodel.cn/usercenter/apikeys)
- Doubao: [Volcengine Ark](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey)

Copy current model IDs from each provider dashboard. Free tiers, model IDs, rate limits, and region availability may change.

### User Flow

The default menu stays small:

- Help
- Settings
- Admin
- Close

Users do not need feature buttons. They can send anything directly:

- Text: chat, translation, search, writing, and Q&A are routed automatically
- Photos: image understanding runs automatically; image generation/editing can be inferred from the text
- Voice: transcription runs automatically and continues the chat
- Files: supported files are parsed and summarized automatically
- Links: webpages are fetched and summarized automatically

To switch provider or model, open `Settings -> Model`. Model buttons use short indexed callback data so Telegram's 64-byte callback limit is not exceeded. Selections are stored in SQLite and survive restarts.

### Fallback Behavior

With `ENABLE_PROVIDER_FALLBACK=true`, the bot tries the configured provider order when the current provider is unavailable, rate limited, misconfigured, returns an empty result, or does not support the requested capability. API keys are masked and never sent to Telegram users.

### Run Locally

```bash
npm install
npm start
```

Validation:

```bash
npm run doctor
npm run verify
npm run test:full
```

### Safety

- Never commit `.env`
- Never paste API keys into Telegram chats
- Use `/whoami` to get your Telegram admin ID
- Set `ADMIN_API_TOKEN` when `ADMIN_API_ENABLED=true`
- Verify model IDs and free quotas in the provider dashboards before deployment
