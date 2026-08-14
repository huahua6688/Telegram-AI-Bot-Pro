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

# Startup diagnostics, health check, and customer support
ENABLE_STARTUP_DIAGNOSTICS=true
SHOW_VERSION_INFO=true
HEALTH_CHECK_ENABLED=true
SUPPORT_ENABLED=true
# Must be a different BotFather token from BOT_TOKEN
SUPPORT_BOT_TOKEN=
SUPPORT_BOT_USERNAME=
SUPPORT_CONTACT_URL=
SUPPORT_ADMIN_IDS=

# Default AI behavior
DEFAULT_AI_PROVIDER=auto
DEFAULT_AI_MODEL=gemini-2.5-flash
ENABLE_USER_PROVIDER_SELECTION=true
ENABLE_USER_MODEL_SELECTION=true

# Automatic fallback
ENABLE_PROVIDER_FALLBACK=true
# 每个备用平台都必须配置自己的 API Key，才能真正跨平台切换
AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter,openai-compatible
# 首次失败后的额外重试次数；1 表示每个模型最多尝试 2 次
AI_PROVIDER_MAX_RETRIES=1
AI_PROVIDER_RETRY_DELAY_MS=800
AI_PROVIDER_COOLDOWN_MS=60000
MODEL_LIST_CACHE_TTL_MS=3600000
MODEL_DISCOVERY_ENABLED=true
ENABLE_RICH_MESSAGES=true
RICH_MESSAGE_MIN_CHARS=600
ENABLE_STREAMING_REPLIES=true
STREAMING_EDIT_INTERVAL_MS=350

# Google Gemini free-tier first
GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite

# OpenRouter free models
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=openrouter/free
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
TRANSLATION_MODEL=gemini-2.5-flash-lite
ROUTER_PROVIDER=gemini
ROUTER_MODEL=gemini-2.5-flash-lite
MEMORY_PROVIDER=gemini
MEMORY_MODEL=gemini-2.5-flash-lite
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
# 没有独立 GEMINI_LIVE_API_KEY 和兼容模型时保持关闭
ENABLE_LIVE_AUDIO=false
ENABLE_LIVE_TRANSLATE=false

# Smart AI Router（任务选模型；模型 ID 从自己的 Provider 控制台复制）
SMART_ROUTING_ENABLED=true
SMART_ROUTING_DEBUG=false
SMART_ROUTING_MIN_CONFIDENCE=0.55
ROUTER_GENERAL_PROVIDER=
ROUTER_GENERAL_MODEL=
ROUTER_TRANSLATION_PROVIDER=
ROUTER_TRANSLATION_MODEL=
ROUTER_CODE_PROVIDER=
ROUTER_CODE_MODEL=
ROUTER_REASONING_PROVIDER=
ROUTER_REASONING_MODEL=
ROUTER_LONG_CONTEXT_PROVIDER=
ROUTER_LONG_CONTEXT_MODEL=
ROUTER_DOCUMENT_PROVIDER=
ROUTER_DOCUMENT_MODEL=
ROUTER_VISION_PROVIDER=
ROUTER_VISION_MODEL=
ROUTER_OCR_PROVIDER=
ROUTER_OCR_MODEL=
ROUTER_TOOL_PROVIDER=
ROUTER_TOOL_MODEL=
ROUTER_CHEAP_PROVIDER=
ROUTER_CHEAP_MODEL=

# Features
# 下面两项是旧 LLM intent router，不是 SMART_ROUTING_ENABLED
ENABLE_AI_ROUTER=false
AI_ROUTER_MODE=single-pass
ENABLE_MEMORY_SUMMARY=true
MEMORY_SUMMARY_INTERVAL=5
ENABLE_TOOL_CALLS=true
ENABLE_WEB_SEARCH=true
ENABLE_GEMINI_GOOGLE_SEARCH=true
ENABLE_URL_FETCH=true
ENABLE_STREAMING_REPLIES=true
TELEGRAM_FILE_MAX_BYTES=10485760
TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS=20000
# 稳定实时搜索建议配置；无 Key 的搜索回退只提供尽力而为的结果
BRAVE_SEARCH_API_KEY=

# Limits
MAX_HISTORY_MESSAGES=32
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=12
# Legacy chat-only fallback; the six STARS_FREE_* values below are authoritative
DAILY_QUOTA=20
STARS_FREE_CHAT_DAILY=20
STARS_FREE_VISION_DAILY=3
STARS_FREE_IMAGE_DAILY=1
STARS_FREE_TTS_DAILY=2
STARS_FREE_LIVE_VOICE_DAILY=2
STARS_FREE_VIDEO_DAILY=0
STARS_PRODUCTS_JSON=[{"id":"starter","title":"入门额度包","titleEn":"Starter credits","description":"适合轻量聊天、图片和语音使用","descriptionEn":"Starter credits for chat, images and voice","price":50,"credits":{"chat":200,"vision":20,"image_generation":5,"tts":20,"live_voice":10,"video":0}},{"id":"standard","title":"标准额度包","titleEn":"Standard credits","description":"适合日常聊天、识图、画图和语音","descriptionEn":"Balanced credits for regular AI use","price":150,"credits":{"chat":800,"vision":80,"image_generation":20,"tts":80,"live_voice":40,"video":0}},{"id":"pro","title":"高级额度包","titleEn":"Pro credits","description":"适合高频使用全部已开放能力","descriptionEn":"Larger credits for frequent AI use","price":500,"credits":{"chat":3000,"vision":300,"image_generation":75,"tts":300,"live_voice":150,"video":0}}]

# Storage / Zeabur
DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json
CONVERSATION_RETENTION_DAYS=30
PRIVACY_SWEEP_INTERVAL_HOURS=24
MINI_APP_SHOW_USER_MESSAGES=false
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

## 启动诊断、客服 Bot 与统一额度

- 启动诊断会在主 Bot 启动前检查 Node.js、版本、部署环境、主 Token、AI Provider、数据库目录和端口；失败日志使用稳定错误码，Token/Key 只显示前 4 位和后 4 位。
- `/health` 返回不含密钥的运行状态、版本、Provider、启动时间和部署信息；`HEALTH_CHECK_ENABLED=false` 时关闭公开的 `/health`，`/ready` 仍可供平台探针使用。管理员“版本信息”由 `SHOW_VERSION_INFO` 控制。
- 客服 Bot 必须使用独立的 BotFather Token。配置 `SUPPORT_CONTACT_URL` 时优先打开该地址，否则使用 `SUPPORT_BOT_USERNAME`；客服管理员通过回复转发消息答复用户，不会暴露管理员账号。
- 客服正文和管理员回复关系只保存在内存；工单关闭、超时或重启即清除。Mini App 默认不返回用户输入，对话默认保留 30 天后自动删除。
- 运行日志默认移除正文、提示词、用户名、IP、User-Agent、异常正文/堆栈和密钥，并把用户关联 ID 转换为进程内匿名标识，避免服务器日志成为另一份用户数据副本。
- Admin API 的 JSON 请求体限制为 64 KB，响应默认禁止缓存；服务器内部异常只返回稳定错误码，审计记录不保存 URL 查询参数或异常正文。
- 网页读取拒绝内网、云元数据和不安全重定向；Telegram 文件采用超时与流式大小限制，避免一次性载入超大内容。
- 每日免费额度和三档 Stars 商品由 `STARS_FREE_*` 与 `STARS_PRODUCTS_JSON` 统一提供给主 Bot、Mini App 和管理员页面，不再分别维护旧数值。详细支付说明见 [Telegram Stars 文档](docs/STARS_PAYMENTS.md)。

## 没填的写什么

| 变量 | 要不要填 | 怎么填 |
| --- | --- | --- |
| `BOT_TOKEN` | 必填 | 填 BotFather 给你的 Telegram Bot Token |
| `ADMIN_USER_IDS` | 建议填 | 给机器人发 `/whoami`，复制数字 ID；多个管理员用英文逗号分隔 |
| `GEMINI_API_KEY` | 必填 | 填 Google AI Studio 的 API Key |
| `OPENROUTER_API_KEY` | 强烈建议 | 填 OpenRouter Key，用来走 `openrouter/free` 动态免费路由 |
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
| OpenRouter | `openrouter/free` | OpenRouter 官方动态免费路由；具体模型会随可用性变化，不保证生产稳定性 |
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

## Smart AI Router（任务选模型）

`SMART_ROUTING_ENABLED=true` 默认按通用、翻译、代码、推理、长上下文、文档、视觉、OCR、工具和低成本任务选择配置的模型。设为 `false` 会跳过这层路由；`SMART_ROUTING_DEBUG` 用于诊断，`SMART_ROUTING_MIN_CONFIDENCE` 默认 `0.55`，无效值回到默认值，超出范围会限制到 `0`–`1`。

实际选择优先级是：用户明确模型 → 用户明确 Provider → 翻译、视觉/媒体等专用功能或模式 → Smart 任务目标 → 默认 Provider / 模型 → 请求失败后的原有备用链。需要固定模型的专用模式会绕过 Smart 路由。Smart 路由只选择首次目标，不会改变 `ENABLE_PROVIDER_FALLBACK`、同 Provider 备用模型或 `AI_PROVIDER_FALLBACK_ORDER`。

配置时注意：

- `DEFAULT_AI_PROVIDER=auto`：每个非空 `ROUTER_*_MODEL` 必须与具体的 `ROUTER_*_PROVIDER` 成对填写。
- 固定的非 `auto` 默认 Provider：任务 Provider 可以留空；多个任务模型会共用该 Provider 的 Key 和 Base URL。
- `ENABLE_AI_ROUTER`、`ROUTER_PROVIDER`、`ROUTER_MODEL` 是旧的 LLM intent router，和新的 `SMART_ROUTING_*` / `ROUTER_<TASK>_*` 不是别名，旧行为保持不变。

Zeabur AI Hub 按标准 OpenAI-compatible Provider 使用：设置 `DEFAULT_AI_PROVIDER=openai-compatible`，将自己的 Key 填入 `AI_API_KEY`，并把 AI Hub 控制台提供的完整 Base URL 填入 `AI_BASE_URL`。项目不硬编码 Zeabur AI Hub URL。这样一个 AI Hub Key 可以配多个任务模型；若默认 Provider 仍是 `auto`，每组 Hub 任务模型还要写 `ROUTER_*_PROVIDER=openai-compatible`。

当平台支持 OpenAI-compatible 的 `GET /models` 时，机器人会自动同步可用模型，管理员也可以在“管理 → 同步平台模型”中手动刷新。此时模型名环境变量可以留空；同步失败时，已填写的模型名仍作为兜底。接口没有提供说明时，界面会明确标注依据模型名称推测的用途。

同步目录会按接口类型分流：聊天/视觉模型进入聊天与识图，图片生成模型进入画图，TTS 和语音识别模型进入对应语音功能。Embedding、Rerank 和 Video 也会保留在专用目录中，但只有项目存在兼容执行接口且相关功能已启用时才会调用，避免把专用模型错误发送到聊天接口。

若 AI Hub 是收费平台，建议使用 `DEFAULT_AI_PROVIDER=auto`，并把 `openai-compatible` 放在 `AI_PROVIDER_FALLBACK_ORDER` 最后。系统会优先尝试前面的免费平台；免费额度不足、限流或模型不可用时，才使用 AI Hub 动态发现的聊天模型兜底，这一步可能产生费用。不接受自动付费兜底时，请从回退顺序移除 `openai-compatible` 或关闭 Provider fallback。把 AI Hub 固定为当前 Provider 时，价格未知的模型仍要求在 Mini App 手动选择。模型只有在平台明确返回零价格或 ID 明确标记免费时才显示“免费”。

Telegram Rich Messages 默认开启。模型会自行选择适合答案的表达方式：普通回答使用普通消息；代码块、公式、表格或足够长的标题/列表结构才使用 Rich Message。为改善手机体验，系统会提示模型默认优先使用正文和纵向列表，只有用户要求表格或多字段对比确实更清楚时才使用表格。发送前会清理表格单元格中的 `<br>`、重复来源和异常链接结尾；宽表会在发送前直接变成纵向字段，紧凑表仅在 Telegram 拒绝后重试纵向布局，最终普通文本降级也不会泄露 `|`、分隔线或 HTML 标签。新闻和联网答案会把检索结果编号转换成 Telegram 原生引用标记；点击正文旁的小链条会打开“来源”弹层，相邻多个来源会合并显示数量。只有无法可靠对应到具体句子时，才显示普通来源列表，避免制造错误引用。开启 `ENABLE_STREAMING_REPLIES=true` 后，Gemini 和 OpenAI-compatible 类平台会直接请求 SSE 流；私聊优先通过 `sendRichMessageDraft` 流式显示 Markdown 结构，并在富草稿不可用时自动降级到 `sendMessageDraft`。完成后再根据模型最终采用的结构决定保存为普通消息还是 Rich Message。群组使用消息编辑模拟流式，平台或 Telegram 不支持流式时会自动降级为普通完整回复。`STREAMING_EDIT_INTERVAL_MS` 限制草稿刷新频率，避免触发 Telegram 429。

Gemini Live 只支持 Google 官方 Gemini Live API，必须使用独立的 `GEMINI_LIVE_API_KEY` 和兼容 Live 模型；不要把第三方 OpenAI-compatible / AI Hub 地址当作 `gemini-live`。

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

- **Inline Mode**：在任意聊天输入 `@机器人用户名 问题`，停止输入后生成一条可直接发送的 AI 答案。空白查询不调用 AI；实时问题会先独立联网检索，因此不依赖当前模型的 Tool Calling 能力，模型失败时会自动尝试备用模型/Provider。
- **Guest Chat Mode**：无需把 Bot 加入聊天，@提及或回复后进行一次性回答。
- **Guard Mode**：处理入群请求；黑名单拒绝、白名单/管理员通过，其余按“审核 / 开放 / 严格”模式处理。管理员可在 Guard 详情页切换模式、添加、移除和查看名单，也可使用 `/allow ID`、`/disallow ID`、`/block ID`、`/unblock ID`。Bot 是群管理员时，会从 `chat_member` 更新自动同步 Telegram 明确标记的封禁和解封；普通主动退群不会加入黑名单。
- **Secretary Mode**：通过 Telegram Business/Secretary 连接处理授权聊天，并在有权限时代表账号回复。
- **Bot-to-Bot Communication**：其他 Bot 可用 `/ask@本机器人 问题` 或直接回复本 Bot；内置去重、限速和单轮终止保护。

代码部署后，还需要在 BotFather 的 Bot Settings 中为当前 Bot 开启对应平台模式。按钮详情页会根据 `getMe` 返回值显示 Inline、Guest、Guard、Secretary 的实际启用状态。访客、Inline 和 Secretary 的第三方消息不写入普通聊天记录或长期记忆。

Inline Query 会在用户输入变化时不断产生 Telegram 更新。程序默认至少输入 2 个字符，并等待用户停止输入 1200ms 后只处理最后一次；空白或过短内容只显示输入提示，不调用搜索、AI 或额度。同一用户的相同问题缓存 60 秒，避免一句话重复消耗多次 AI 调用。每次查询最多占用 8 秒，其中联网预取最多等待 2.3 秒、单个 AI 模型最多等待 2.2 秒，并为 Telegram 回传结果保留绝对投递截止时间；超时、模型 429/503 或新输入会立即切换/取消，避免回复已经失效的 Query ID。实时搜索优先使用 `BRAVE_SEARCH_API_KEY`，未配置或失败时会在剩余时限内回退到免密搜索。可通过 `INLINE_QUERY_MIN_CHARS`、`INLINE_QUERY_DEBOUNCE_MS`、`INLINE_QUERY_RESPONSE_TIMEOUT_MS`、`INLINE_QUERY_SEARCH_TIMEOUT_MS`、`INLINE_QUERY_AI_ATTEMPT_TIMEOUT_MS` 和 `INLINE_QUERY_CACHE_TTL_MS` 调整。

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

# Startup diagnostics, health check, and customer support
ENABLE_STARTUP_DIAGNOSTICS=true
SHOW_VERSION_INFO=true
HEALTH_CHECK_ENABLED=true
SUPPORT_ENABLED=true
# Must be a different BotFather token from BOT_TOKEN
SUPPORT_BOT_TOKEN=
SUPPORT_BOT_USERNAME=
SUPPORT_CONTACT_URL=
SUPPORT_ADMIN_IDS=

# Default AI behavior
DEFAULT_AI_PROVIDER=auto
DEFAULT_AI_MODEL=gemini-2.5-flash
ENABLE_USER_PROVIDER_SELECTION=true
ENABLE_USER_MODEL_SELECTION=true

# Automatic fallback
ENABLE_PROVIDER_FALLBACK=true
# Each fallback provider needs its own API key for real cross-provider failover
AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter,openai-compatible
# Extra retries after the first failure; 1 means at most 2 attempts per model
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
OPENROUTER_MODEL=openrouter/free
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
TRANSLATION_MODEL=gemini-2.5-flash-lite
ROUTER_PROVIDER=gemini
ROUTER_MODEL=gemini-2.5-flash-lite
MEMORY_PROVIDER=gemini
MEMORY_MODEL=gemini-2.5-flash-lite
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
# Keep disabled without a separate GEMINI_LIVE_API_KEY and compatible models
ENABLE_LIVE_AUDIO=false
ENABLE_LIVE_TRANSLATE=false

# Smart AI Router (task-to-model routing; copy model IDs from your provider)
SMART_ROUTING_ENABLED=true
SMART_ROUTING_DEBUG=false
SMART_ROUTING_MIN_CONFIDENCE=0.55
ROUTER_GENERAL_PROVIDER=
ROUTER_GENERAL_MODEL=
ROUTER_TRANSLATION_PROVIDER=
ROUTER_TRANSLATION_MODEL=
ROUTER_CODE_PROVIDER=
ROUTER_CODE_MODEL=
ROUTER_REASONING_PROVIDER=
ROUTER_REASONING_MODEL=
ROUTER_LONG_CONTEXT_PROVIDER=
ROUTER_LONG_CONTEXT_MODEL=
ROUTER_DOCUMENT_PROVIDER=
ROUTER_DOCUMENT_MODEL=
ROUTER_VISION_PROVIDER=
ROUTER_VISION_MODEL=
ROUTER_OCR_PROVIDER=
ROUTER_OCR_MODEL=
ROUTER_TOOL_PROVIDER=
ROUTER_TOOL_MODEL=
ROUTER_CHEAP_PROVIDER=
ROUTER_CHEAP_MODEL=

# Features
# These are the legacy LLM intent-router settings, not SMART_ROUTING_ENABLED.
ENABLE_AI_ROUTER=false
AI_ROUTER_MODE=single-pass
ENABLE_MEMORY_SUMMARY=true
MEMORY_SUMMARY_INTERVAL=5
ENABLE_TOOL_CALLS=true
ENABLE_WEB_SEARCH=true
ENABLE_GEMINI_GOOGLE_SEARCH=true
ENABLE_URL_FETCH=true
TOOL_MAX_CONCURRENT_CALLS=8
ENABLE_STREAMING_REPLIES=true
# Recommended for stable search; keyless fallback is best-effort only
BRAVE_SEARCH_API_KEY=

# Limits
MAX_HISTORY_MESSAGES=32
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=12
# Legacy chat-only fallback; the six STARS_FREE_* values below are authoritative
DAILY_QUOTA=20
STARS_FREE_CHAT_DAILY=20
STARS_FREE_VISION_DAILY=3
STARS_FREE_IMAGE_DAILY=1
STARS_FREE_TTS_DAILY=2
STARS_FREE_LIVE_VOICE_DAILY=2
STARS_FREE_VIDEO_DAILY=0
STARS_PRODUCTS_JSON=[{"id":"starter","title":"入门额度包","titleEn":"Starter credits","description":"适合轻量聊天、图片和语音使用","descriptionEn":"Starter credits for chat, images and voice","price":50,"credits":{"chat":200,"vision":20,"image_generation":5,"tts":20,"live_voice":10,"video":0}},{"id":"standard","title":"标准额度包","titleEn":"Standard credits","description":"适合日常聊天、识图、画图和语音","descriptionEn":"Balanced credits for regular AI use","price":150,"credits":{"chat":800,"vision":80,"image_generation":20,"tts":80,"live_voice":40,"video":0}},{"id":"pro","title":"高级额度包","titleEn":"Pro credits","description":"适合高频使用全部已开放能力","descriptionEn":"Larger credits for frequent AI use","price":500,"credits":{"chat":3000,"vision":300,"image_generation":75,"tts":300,"live_voice":150,"video":0}}]

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

## Startup Diagnostics, Support Bot, and Unified Credits

- Startup diagnostics validate Node.js, version metadata, deployment environment, the main Bot token, AI provider configuration, the database directory, and ports before launch. Secret values are always masked.
- `/health` exposes only safe status/version/provider/timestamp data. Set `HEALTH_CHECK_ENABLED=false` to disable the public endpoint while keeping `/ready` available for platform probes. `SHOW_VERSION_INFO` controls the administrator version view.
- The support Bot requires a separate BotFather token. `SUPPORT_CONTACT_URL` takes priority over `SUPPORT_BOT_USERNAME`; administrators answer users by replying to copied tickets without exposing their own identity.
- Main Bot, Mini App, and administrator views read daily free limits and all three Stars packages from the same `STARS_FREE_*` and `STARS_PRODUCTS_JSON` configuration. See [Telegram Stars billing](docs/STARS_PAYMENTS.md).

## What To Fill

| Variable | Required? | Value |
| --- | --- | --- |
| `BOT_TOKEN` | Required | Your Telegram BotFather token |
| `ADMIN_USER_IDS` | Recommended | Send `/whoami` to the bot and copy the numeric ID; separate multiple IDs with commas |
| `GEMINI_API_KEY` | Required | Your Google AI Studio API key |
| `OPENROUTER_API_KEY` | Strongly recommended | Your OpenRouter key for the `openrouter/free` dynamic free router |
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
| OpenRouter | `openrouter/free` | Official dynamic free router; the selected model varies with availability and is not production-grade |
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

## Smart AI Router

`SMART_ROUTING_ENABLED=true` routes general, translation, code, reasoning, long-context, document, vision, OCR, tool, and low-cost tasks to configured targets. Set it to `false` to bypass this layer. `SMART_ROUTING_DEBUG` enables diagnostics, while `SMART_ROUTING_MIN_CONFIDENCE` defaults to `0.55`; invalid values use the default and numeric values are clamped to `0`–`1`.

Selection priority is: explicit user model → explicit user provider → dedicated feature/mode provider and model (translation, vision/media, and similar modes) → Smart rule target → default provider/model → the existing failure fallback chain. Dedicated modes bypass Smart routing where required. Smart routing selects the first target only; it does not change `ENABLE_PROVIDER_FALLBACK`, same-provider fallback models, or `AI_PROVIDER_FALLBACK_ORDER`.

For a free-first deployment with a paid Zeabur AI Hub safety net, keep `DEFAULT_AI_PROVIDER=gemini`, enable fallback, and set `AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter,openai-compatible`. Model discovery for `openai-compatible` remains active even though it is not the default. HTTP 429, quota exhaustion, unavailable models, timeouts, and transient failures continue through the list. Automatic mode always restores fallback; a manually pinned provider/model can still disable it.

Configuration rules:

- With `DEFAULT_AI_PROVIDER=auto`, every non-empty `ROUTER_*_MODEL` needs a matching concrete `ROUTER_*_PROVIDER`.
- With a fixed, non-`auto` default provider, route providers may stay blank and multiple task models share that provider’s key and Base URL.
- `ENABLE_AI_ROUTER`, `ROUTER_PROVIDER`, and `ROUTER_MODEL` are the legacy LLM intent router. They are not aliases for the new `SMART_ROUTING_*` / `ROUTER_<TASK>_*` settings, and their behavior is unchanged.

Treat Zeabur AI Hub as a standard OpenAI-compatible provider: set `DEFAULT_AI_PROVIDER=openai-compatible`, put your key in `AI_API_KEY`, and paste the full Base URL supplied by the AI Hub console into `AI_BASE_URL`. The project does not hard-code a Zeabur AI Hub URL. One Hub key can serve multiple task models; with `DEFAULT_AI_PROVIDER=auto`, also set each Hub task’s provider to `openai-compatible`.

Gemini Live remains official-only: use Google’s Gemini Live API with a separate `GEMINI_LIVE_API_KEY` and compatible Live models. Do not configure a third-party OpenAI-compatible gateway or AI Hub as `gemini-live`.

## Safety

- Never commit `.env`
- Never paste API keys into Telegram chats
- Keep unused paid providers blank
- Verify current model IDs in provider dashboards before deployment


## 客服工单隐私与协作

- 新工单先向全部客服发送不含用户身份和正文的摘要。
- 接单后只有当前负责客服收到完整历史消息和后续消息。
- 支持重复转交、退回待接单和关闭；非负责客服的回复不会发给用户。
- 工单状态只保存在单实例进程内存中，不保存正文或附件；重新部署后旧工单失效。
- 客服消息启用 Telegram 内容保护，但无法阻止已获授权客服截图。
- Telegram Bot 私聊不是端到端加密，不得宣传为端到端加密客服。
- 部署时保持单实例；多个副本会产生互不一致的内存工单状态。
