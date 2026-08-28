# 环境变量完整说明

本页以当前代码为准，适用于 Zeabur、Docker 和普通 Node.js 部署。可复制的完整模板见：

- Zeabur：`.env.zeabur.example`
- Docker / 本地：`.env.example`

不要把真实 Token、API Key、加密密钥或用户数据提交到 Git。生产密钥只放在部署平台的 Secret 环境变量中。

## 1. 先看这一节：已有部署怎么升级

如果生产环境已经存在 `CHAT_ENCRYPTION_KEY`，必须保留原值，不能重新生成。更换后，数据库里已经加密的聊天、摘要和记忆将无法解密，程序会以 `CHAT_ENCRYPTION_KEY_MISMATCH` 拒绝继续使用错误密钥。

PR #51 对现有 Zeabur 部署新增的必要检查是：

```env
CHAT_ENCRYPTION_REQUIRED=true
CHAT_ENCRYPTION_KEY=保留你原来已经使用的值
LOG_PRIVACY_KEY=新生成一个与聊天密钥不同的随机值
ENABLE_NATIVE_DRAFT_STREAMING=false
```

生成新密钥时，在任意 Linux / macOS 终端执行：

```bash
openssl rand -base64 48
```

`LOG_PRIVACY_KEY` 只负责生成稳定的日志匿名 ID，不用于解密聊天；仍应长期固定，不能写进日志、截图或仓库。

Zeabur 会注入 `ZEABUR_SERVICE_ID`、`ZEABUR_PROJECT_ID` 或 `ZEABUR_ENVIRONMENT_ID`，程序据此自动识别生产环境。即使没有手动填写 `NODE_ENV=production`，生产密钥检查仍然生效。建议仍显式设置：

```env
NODE_ENV=production
```

## 2. 变量状态怎么理解

| 状态 | 含义 |
| --- | --- |
| 必填 | 缺少后程序无法安全启动或主要功能不可用 |
| 条件必填 | 只有启用对应功能时必须填写 |
| 推荐 | 有安全或稳定默认值，但生产环境建议显式填写 |
| 可选 | 留空时关闭对应能力或使用默认值 |
| 兼容 | 只为旧部署保留，新部署不建议继续使用 |

布尔变量可使用 `true/false`。列表变量使用英文逗号分隔，不要加中文逗号。

## 3. 最小可运行的 Zeabur 配置

至少需要主 Bot、一个可用 AI Provider、持久化数据库和生产安全密钥：

```env
NODE_ENV=production
BOT_TOKEN=
ADMIN_USER_IDS=

DEFAULT_AI_PROVIDER=gemini
DEFAULT_AI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=

DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json
CHAT_ENCRYPTION_REQUIRED=true
CHAT_ENCRYPTION_KEY=
LOG_PRIVACY_KEY=

PORT=8080
HEALTH_PORT=8080
ENABLE_NATIVE_DRAFT_STREAMING=false
ADMIN_API_ENABLED=false
AGENT_ENABLED=false
```

模型 ID 和平台额度会变化，必须从自己的 Provider 控制台复制。模板中的模型名是配置示例，不保证所有账号、地区和时间都能使用。

## 4. Telegram 主 Bot 与启动

| 变量 | 状态 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `BOT_TOKEN` | 必填 | 空 | BotFather 生成的主 Bot Token |
| `ADMIN_USER_IDS` | 推荐 | 空 | Bot 管理员 Telegram 数字 ID；多个用英文逗号分隔 |
| `NODE_ENV` | 推荐 | 空 | Zeabur 建议填 `production`；本地可填 `development` |
| `ENABLE_STARTUP_DIAGNOSTICS` | 推荐 | `true` | 启动前检查 Token、Provider、端口和数据库目录 |
| `SHOW_VERSION_INFO` | 可选 | `true` | 是否向管理员显示安全的版本信息入口 |
| `HEALTH_CHECK_ENABLED` | 推荐 | `true` | 是否公开 `/health`；`/ready` 不受影响 |
| `TELEGRAM_STARTUP_MAX_RETRIES` | 可选 | `6` | Telegram 临时网络错误时最多重试次数，范围 `0–20` |
| `TELEGRAM_STARTUP_RETRY_BASE_MS` | 可选 | `1000` | 第一次重试的基础等待时间，最少 100ms |
| `TELEGRAM_STARTUP_RETRY_MAX_MS` | 可选 | `30000` | 退避等待上限，最少 1000ms |

`BOT_TOKEN` 无效属于永久错误，不会无限重试。Token 和 API Key 在诊断中只会显示掩码，正文不会写入结构化日志。

## 5. 客服 Bot

| 变量 | 状态 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `SUPPORT_ENABLED` | 可选 | `true` | 是否显示客服入口并允许启动独立客服 Bot |
| `SUPPORT_BOT_TOKEN` | 条件必填 | 空 | 第二个 BotFather Token，不能等于 `BOT_TOKEN` |
| `SUPPORT_BOT_USERNAME` | 推荐 | 空 | 客服 Bot 用户名，用来生成私聊 deep link |
| `SUPPORT_CONTACT_URL` | 可选 | 空 | 自定义客服地址；设置后优先于用户名链接 |
| `SUPPORT_ADMIN_IDS` | 条件必填 | 空 | 普通客服人员 Telegram 数字 ID |
| `SUPPORT_SUPER_ADMIN_IDS` | 可选 | 空 | 一级客服管理员 ID；自动具有客服权限 |
| `SUPPORT_RATE_LIMIT_WINDOW_MS` | 可选 | `60000` | 客服私聊限流窗口 |
| `SUPPORT_RATE_LIMIT_MAX_MESSAGES` | 可选 | `6` | 每个窗口最多接受的用户消息数 |
| `SUPPORT_TICKET_AUTO_CLOSE_MINUTES` | 可选 | `1440` | 客服回复后用户持续无新消息时自动关闭工单；范围 `1–10080` |

只想跳转已有客服页面时，可以设置 `SUPPORT_CONTACT_URL` 并让 `SUPPORT_BOT_TOKEN` 留空。

独立客服 Bot 只接受 private chat。群组、超级群组和频道中的普通消息、提及、命令和媒体全部静默忽略，不回复、不建工单、不转发、不进入限流。

私聊支持通过 Telegram `copyMessage` 安全复制的普通用户消息：文字、图片、语音、文件、视频、圆形视频、音频、GIF/动画、贴纸、位置、地点、联系人、投票、骰子，以及 Bot API/Telegraf 暴露且可复制的普通媒体。系统消息、Bot 消息、invoice、paid media、giveaway、付款与其他系统事件不会进入工单。无法复制的普通类型会友好提示，不会中断已有工单。

## 6. 默认 Provider、模型选择与故障切换

| 变量 | 状态 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `DEFAULT_AI_PROVIDER` | 必填 | `auto` | 默认平台；可用 `auto` 或具体 Provider ID |
| `DEFAULT_AI_MODEL` | 推荐 | 按 Provider | 默认模型 ID |
| `ENABLE_USER_PROVIDER_SELECTION` | 可选 | `true` | 是否允许每个用户选择自己的 Provider |
| `ENABLE_USER_MODEL_SELECTION` | 可选 | `true` | 是否允许每个用户选择自己的模型 |
| `ENABLE_PROVIDER_FALLBACK` | 推荐 | `true` | 请求失败后是否尝试备用模型和其他平台 |
| `AI_PROVIDER_FALLBACK_ORDER` | 推荐 | `gemini,groq,openrouter,openai-compatible` | 跨平台回退顺序 |
| `AI_PROVIDER_MAX_RETRIES` | 可选 | `1` | 首次失败后的额外重试次数；`1` 表示最多尝试两次 |
| `AI_PROVIDER_RETRY_DELAY_MS` | 可选 | `800` | 重试前等待时间 |
| `AI_PROVIDER_COOLDOWN_MS` | 可选 | `60000` | 平台连续失败后的冷却时间 |
| `MODEL_DISCOVERY_ENABLED` | 推荐 | `true` | 对支持 `/models` 的 OpenAI-compatible 网关自动发现模型 |
| `MODEL_LIST_CACHE_TTL_MS` | 可选 | `3600000` | 模型目录缓存时间 |

真正的跨平台回退要求顺序中的每个平台都配置自己的 Key。只填写 Gemini Key，不能在 Gemini 限额耗尽后凭空切换到 OpenRouter 或 Groq。

选择顺序是：用户明确模型 → 用户明确 Provider → 专用媒体/翻译能力 → Smart 路由 → 默认 Provider/模型 → 同平台备用模型 → 跨平台回退。

## 7. Provider 配置

每个平台通常使用四组变量：`*_API_KEY`、`*_BASE_URL`、`*_MODEL`、`*_FALLBACK_MODELS`。备用模型用英文逗号分隔。

| Provider ID | Key 变量 | Base URL 变量 | 模型变量 | 内置 Base URL |
| --- | --- | --- | --- | --- |
| `gemini` | `GEMINI_API_KEY` | `GEMINI_BASE_URL` | `GEMINI_MODEL` / `GEMINI_FALLBACK_MODELS` | Google Generative Language v1beta |
| `gemini-live` | `GEMINI_LIVE_API_KEY` | `GEMINI_LIVE_BASE_URL` | `GEMINI_LIVE_MODEL` | Google Generative Language v1beta |
| `groq` | `GROQ_API_KEY` | `GROQ_BASE_URL` | `GROQ_MODEL` / `GROQ_FALLBACK_MODELS` | `https://api.groq.com/openai/v1` |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` | `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODELS` | `https://openrouter.ai/api/v1` |
| `github-models` | `GITHUB_MODELS_API_KEY` | `GITHUB_MODELS_BASE_URL` | `GITHUB_MODELS_MODEL` / `GITHUB_MODELS_FALLBACK_MODELS` | `https://models.github.ai/inference` |
| `huggingface` | `HUGGINGFACE_API_KEY` | `HUGGINGFACE_BASE_URL` | `HUGGINGFACE_MODEL` / `HUGGINGFACE_FALLBACK_MODELS` | `https://router.huggingface.co/v1` |
| `mistral` | `MISTRAL_API_KEY` | `MISTRAL_BASE_URL` | `MISTRAL_MODEL` / `MISTRAL_FALLBACK_MODELS` | `https://api.mistral.ai/v1` |
| `openai` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | `OPENAI_MODEL` / `OPENAI_FALLBACK_MODELS` | `https://api.openai.com/v1` |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | `ANTHROPIC_MODEL` / `ANTHROPIC_FALLBACK_MODELS` | `https://api.anthropic.com` |
| `deepseek` | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` | `DEEPSEEK_MODEL` / `DEEPSEEK_FALLBACK_MODELS` | `https://api.deepseek.com/v1` |
| `qwen` | `QWEN_API_KEY` | `QWEN_BASE_URL` | `QWEN_MODEL` / `QWEN_FALLBACK_MODELS` | DashScope compatible-mode v1 |
| `grok` | `GROK_API_KEY` | `GROK_BASE_URL` | `GROK_MODEL` / `GROK_FALLBACK_MODELS` | `https://api.x.ai/v1` |
| `glm` | `GLM_API_KEY` | `GLM_BASE_URL` | `GLM_MODEL` / `GLM_FALLBACK_MODELS` | BigModel v4 |
| `doubao` | `DOUBAO_API_KEY` | `DOUBAO_BASE_URL` | `DOUBAO_MODEL` / `DOUBAO_FALLBACK_MODELS` | Volcengine Ark v3 |
| `openai-compatible` | `AI_API_KEY` | `AI_BASE_URL` | `AI_MODEL` / `AI_FALLBACK_MODELS` | 不应依赖默认地址，填写网关实际地址 |

OpenRouter 还支持：

```env
OPENROUTER_HTTP_REFERER=
OPENROUTER_APP_TITLE=Telegram AI Bot Pro
```

Anthropic 使用 `ANTHROPIC_API_VERSION`，默认 `2023-06-01`。`DEEPSEEK_API_VERSION`、`QWEN_API_VERSION`、`GROK_API_VERSION`、`GLM_API_VERSION`、`DOUBAO_API_VERSION` 是可选的兼容头；平台没有要求时留空。

旧别名 `GITHUB_TOKEN` 和 `HF_TOKEN` 仍能分别作为 GitHub Models、Hugging Face Key，但新部署应使用明确的 `GITHUB_MODELS_API_KEY` 与 `HUGGINGFACE_API_KEY`，避免与 GitHub App Token 混淆。

### Zeabur AI Hub / 其他集成网关

AI Hub 按 `openai-compatible` 配置：

```env
DEFAULT_AI_PROVIDER=openai-compatible
AI_API_KEY=
AI_BASE_URL=控制台提供的完整API地址
AI_MODEL=控制台显示的准确模型ID
MODEL_DISCOVERY_ENABLED=true
```

项目不硬编码 Zeabur AI Hub 地址。以后换到另一家 OpenAI-compatible 网关，只需替换 Key、Base URL 和模型 ID；Telegram、Agent、GitHub 和 SQLite 任务数据不需要重做。

## 8. 专用能力 Provider

| 功能 | Provider 变量 | 模型变量 | 默认行为 |
| --- | --- | --- | --- |
| 翻译 | `TRANSLATION_PROVIDER` | `TRANSLATION_MODEL` | 跟随默认 Provider / 模型 |
| 旧意图路由 | `ROUTER_PROVIDER` | `ROUTER_MODEL` | 跟随默认或翻译模型 |
| 记忆总结 | `MEMORY_PROVIDER` | `MEMORY_MODEL` | 跟随路由/默认模型 |
| 识图 | `VISION_PROVIDER` | `VISION_MODEL` | 默认 Gemini |
| 语音转写 | `TRANSCRIPTION_PROVIDER` | `TRANSCRIPTION_MODEL` | 默认 `gemini-live` |
| TTS | `TTS_PROVIDER` | `TTS_MODEL` | 默认 `gemini-live` |
| 图片生成 | `IMAGE_PROVIDER` | `IMAGE_MODEL` | 默认 OpenAI-compatible / `gpt-image-1` |

长期记忆总结还可配置：

```env
ENABLE_MEMORY_SUMMARY=true
MEMORY_SUMMARY_INTERVAL=5
```

`ENABLE_MEMORY_SUMMARY` 控制是否生成长期摘要；`MEMORY_SUMMARY_INTERVAL` 表示累计多少条新消息后尝试更新摘要，最少为 1。敏感信息检测始终位于记忆写入前，不应为了记忆功能关闭。

其他相关变量：

```env
GEMINI_LIVE_TRANSCRIPTION_MODEL=
GEMINI_LIVE_TTS_MODEL=
TTS_VOICE=alloy
IMAGE_SIZE=1024x1024
ENABLE_LIVE_AUDIO=false
ENABLE_LIVE_TRANSLATE=false
ENABLE_VIDEO=false
```

Gemini Live 只走 Google 官方 Live API，第三方 OpenAI-compatible 网关不能当作 `gemini-live`。没有独立 Live Key 和兼容模型时保持关闭。

`ENABLE_VIDEO` 当前不会打开可消费的视频模型链；商品目录会强制把视频额度设为 0，避免出售无法使用的能力。

## 9. Smart AI Router

```env
SMART_ROUTING_ENABLED=true
SMART_ROUTING_DEBUG=false
SMART_ROUTING_MIN_CONFIDENCE=0.55
```

Smart Router 按任务选择首次模型目标，不改变备用模型、跨平台回退或计费规则。支持十类任务：

| 任务 | Provider 变量 | 模型变量 |
| --- | --- | --- |
| 通用 | `ROUTER_GENERAL_PROVIDER` | `ROUTER_GENERAL_MODEL` |
| 翻译 | `ROUTER_TRANSLATION_PROVIDER` | `ROUTER_TRANSLATION_MODEL` |
| 代码 | `ROUTER_CODE_PROVIDER` | `ROUTER_CODE_MODEL` |
| 推理 | `ROUTER_REASONING_PROVIDER` | `ROUTER_REASONING_MODEL` |
| 长上下文 | `ROUTER_LONG_CONTEXT_PROVIDER` | `ROUTER_LONG_CONTEXT_MODEL` |
| 文档 | `ROUTER_DOCUMENT_PROVIDER` | `ROUTER_DOCUMENT_MODEL` |
| 视觉 | `ROUTER_VISION_PROVIDER` | `ROUTER_VISION_MODEL` |
| OCR | `ROUTER_OCR_PROVIDER` | `ROUTER_OCR_MODEL` |
| 工具 | `ROUTER_TOOL_PROVIDER` | `ROUTER_TOOL_MODEL` |
| 低成本 | `ROUTER_CHEAP_PROVIDER` | `ROUTER_CHEAP_MODEL` |

`DEFAULT_AI_PROVIDER=auto` 时，每个非空的任务模型必须与具体任务 Provider 成对填写。默认 Provider 固定为某个平台时，任务 Provider 可以留空，模型会归入该固定平台。

`ENABLE_AI_ROUTER`、`AI_ROUTER_MODE`、`ROUTER_PROVIDER` 和 `ROUTER_MODEL` 是旧 LLM 意图路由，不是 Smart Router 的别名：

```env
ENABLE_AI_ROUTER=false
AI_ROUTER_MODE=single-pass
```

## 10. 模型提示词、输出与 Telegram 流式消息

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `AI_SYSTEM_PROMPT` | 内置助手提示词 | 全局基础系统提示词 |
| `AI_TEMPERATURE` | `0.6` | 生成随机度 |
| `AI_MAX_OUTPUT_TOKENS` | `2048` | 兼容 Provider 单次最大输出 token，限制 `128–16384` |
| `AI_MAX_TOOL_STEPS` | `3` | 单次回答最多工具循环步数 |
| `ENABLE_STREAMING_REPLIES` | `true` | Provider 支持时启用流式输出 |
| `ENABLE_NATIVE_DRAFT_STREAMING` | `false` | 是否使用会消失的 Telegram 原生临时草稿 |
| `ENABLE_RICH_MESSAGES` | `true` | 是否使用 Telegram Rich Message |
| `RICH_MESSAGE_MIN_CHARS` | `600` | 普通结构化回答启用 Rich Message 的长度阈值，最少 200 |
| `STREAMING_EDIT_INTERVAL_MS` | `350` | 编辑同一条流式消息的最短间隔 |
| `STREAMING_MIN_LENGTH` | `160` | 进入流式展示的最小文本长度 |

生产建议保持 `ENABLE_NATIVE_DRAFT_STREAMING=false`。私聊会创建一条持久消息并持续编辑同一 `message_id`；完成后不会再发送第二份回答，也不会因原生草稿生命周期而自动消失。Rich Message、HTML 实体和引用参数被 Telegram 拒绝时，会在同一回复链安全降级。

## 11. 工具、搜索和联网权限

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `ENABLE_TOOL_CALLS` | `true` | 总工具开关 |
| `ENABLE_WEB_SEARCH` | `true` | 联网搜索开关 |
| `ENABLE_GEMINI_GOOGLE_SEARCH` | `true` | Gemini 原生 Google Search 开关 |
| `ENABLE_URL_FETCH` | `true` | 公开网页读取开关 |
| `TAVILY_API_KEY` | 空 | Tavily 搜索 Key |
| `BRAVE_SEARCH_API_KEY` | 空 | Brave Search Key；稳定实时搜索建议配置 |
| `TOOL_ALLOWED_NAMES` | `get_time,get_weather,fetch_url,web_search` | 允许注册的工具 |
| `TOOL_ALLOWED_USER_IDS` | 空 | 仅允许这些用户调用工具；空表示不按用户限制 |
| `TOOL_ALLOWED_CHAT_IDS` | 空 | 仅允许这些聊天调用工具 |
| `TOOL_BLOCKED_USER_IDS` | 空 | 明确禁止工具的用户 |
| `TOOL_ADMIN_ONLY_NAMES` | 空 | 仅管理员可用的工具名 |
| `TOOL_MAX_CALLS_PER_MESSAGE` | `4` | 每条消息最多工具调用数 |
| `TOOL_MAX_CONCURRENT_CALLS` | `8` | 单进程并发联网工具数，限制 `1–64` |
| `TOOL_USER_WINDOW_MS` | `60000` | 单用户工具限流窗口 |
| `TOOL_USER_MAX_CALLS` | `20` | 窗口内最多调用数 |
| `NETWORK_TOOL_SCOPE` | `all` | 联网工具总体范围 |
| `NETWORK_TOOL_ALLOWED_USER_IDS` | 空 | 联网工具用户白名单 |
| `NETWORK_TOOL_ALLOWED_CHAT_IDS` | 空 | 联网工具聊天白名单 |

`fetch_url` 只接受公开 HTTP/HTTPS 80/443 地址，拒绝本机、内网、云元数据、保留地址和不安全重定向；响应正文有大小上限。没有搜索 Key 时的免密搜索只是尽力而为，不应当成稳定生产数据源。

## 12. 文件、上下文、限流与隐私聊天

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `DOCUMENT_MAX_BYTES` | `6291456` | 文档解析上限，默认 6 MiB |
| `DOCUMENT_MAX_CHARS` | `12000` | 文档送入模型的最大字符数 |
| `DOCUMENT_CHUNK_CHARS` | `1800` | 文档分块字符数 |
| `TELEGRAM_FILE_MAX_BYTES` | `10485760` | Telegram 下载文件上限，最少 1 MiB |
| `TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS` | `20000` | 文件下载超时，限制 `1000–60000ms` |
| `MAX_HISTORY_MESSAGES` | `32` | 普通对话最多带入的历史条数 |
| `MAX_CONTEXT_CHARS` | `48000` | 上下文总字符上限 |
| `MAX_INPUT_CHARS` | `12000` | 单条用户输入字符上限 |
| `MAX_OUTPUT_CHARS` | `3500` | Telegram 普通输出切分前目标上限 |
| `REQUEST_TIMEOUT_MS` | `120000` | AI 请求总超时 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 普通请求限流窗口 |
| `RATE_LIMIT_MAX_REQUESTS` | `12` | 每窗口普通请求数 |

临时隐私聊天只保存在当前 Bot 进程内，不写普通对话历史和长期记忆：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PRIVACY_SESSION_TTL_MINUTES` | `30` | 临时会话有效时间，最大 1440 分钟 |
| `PRIVACY_CONTEXT_MESSAGES` | `6` | 每次最多带入的临时历史条数，最大 40 |
| `PRIVACY_CONTEXT_CHARS` | `12000` | 临时上下文字符数，最大 100000 |
| `PRIVACY_SESSION_MAX_MESSAGES` | `50` | 单次隐私会话最多消息数，最大 1000 |

## 13. 数据库存储、加密和保留

| 变量 | 状态 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `DATABASE_FILE` | 必填 | `./data/bot-data.db` | SQLite 主数据库 |
| `DATA_FILE` | 兼容 | `./data/bot-data.json` | 旧 JSON 数据迁移入口 |
| `CHAT_ENCRYPTION_REQUIRED` | 生产必填 | 生产自动为 `true` | 是否强制聊天内容加密 |
| `CHAT_ENCRYPTION_KEY` | 生产必填 | 空 | 对话、主题摘要、长期记忆的 AES-GCM 主密钥 |
| `LOG_PRIVACY_KEY` | 生产必填 | 空 | 生成跨重启稳定匿名日志 ID 的独立密钥 |
| `CONVERSATION_RETENTION_DAYS` | 推荐 | `30` | 删除过期私聊会话和旧对话；`0` 表示不自动清理 |
| `PRIVACY_SWEEP_INTERVAL_HOURS` | 可选 | `24` | 清理任务间隔，限制 `1–168` 小时 |
| `MINI_APP_SHOW_USER_MESSAGES` | 推荐 | `false` | Mini App/管理会话是否返回用户原文 |

`CHAT_ENCRYPTION_KEY` 和 `LOG_PRIVACY_KEY` 至少 32 个字符、无空格、不能使用示例值，且必须不同。聊天密钥用来解密历史数据，不能轮换；日志密钥轮换不会破坏数据库，但会让重启前后的匿名用户 ID 无法连续追踪。

设置新聊天密钥后，旧明文记录会在数据库迁移中加密。部署前仍应备份 `/data/bot-data.db`。

长期记忆在写入前会进行敏感信息检测；疑似密码、验证码、API Key、私钥或助记词的内容不会发送给总结模型，也不会保留在长期记忆中。这不代替用户侧的安全意识，Bot 仍会提示不要发送敏感凭据。

## 14. Telegram Stars、免费额度与付费结算

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `STARS_PAYMENTS_ENABLED` | `true` | Stars 商品与付款总开关 |
| `STARS_PRODUCTS_JSON` | 空数组 | 商品、Stars 价格和六类额度的唯一配置源 |
| `STARS_FREE_CHAT_DAILY` | `DAILY_QUOTA` 或 `20` | 每日免费聊天额度 |
| `STARS_FREE_VISION_DAILY` | `3` | 每日免费识图额度 |
| `STARS_FREE_IMAGE_DAILY` | `1` | 每日免费图片生成额度 |
| `STARS_FREE_TTS_DAILY` | `2` | 每日免费 TTS 额度 |
| `STARS_FREE_LIVE_VOICE_DAILY` | `2` | 当前用于语音转写的每日额度 |
| `STARS_FREE_VIDEO_DAILY` | `0` | 视频额度；当前功能未实现 |
| `STARS_ORDER_TTL_MINUTES` | `60` | 未付款订单有效期，最少 5 分钟 |
| `STARS_USAGE_RESERVATION_TTL_MINUTES` | `15` | 异常中断后预留额度自动释放时间 |
| `STARS_REFUND_LEASE_SECONDS` | `300` | 退款操作租约时间 |
| `STARS_TERMS_TEXT` | 空 | 自定义付款条款 |
| `STARS_SUPPORT_TEXT` | 空 | 自定义支付支持说明 |
| `DAILY_QUOTA` | `20` | 旧聊天免费额度兼容值；新部署以 `STARS_FREE_CHAT_DAILY` 为准 |

付费模型结算变量：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `BILLING_USD_PER_CHAT_CREDIT` | `0` | 一个聊天额度代表多少美元；为 `0` 时付费聊天安全关闭 |
| `BILLING_USD_PER_VISION_CREDIT` | `0` | 一个识图额度代表多少美元 |
| `BILLING_USD_PER_IMAGE_CREDIT` | `0` | 一个图片额度代表多少美元 |
| `BILLING_USD_PER_TTS_CREDIT` | `0` | 一个 TTS 额度代表多少美元 |
| `BILLING_USD_PER_LIVE_VOICE_CREDIT` | `0` | 一个语音转写额度代表多少美元 |
| `BILLING_USD_PER_VIDEO_CREDIT` | `0` | 一个视频额度代表多少美元；当前视频链未实现 |
| `BILLING_COST_MARKUP` | `1.25` | 成本加成倍数，最少 1 |
| `BILLING_MAX_REQUEST_USD` | `2` | 单次请求预冻结的美元预算 |
| `FREE_PROVIDER_PATTERNS` | 模板列表 | 可使用每日免费额度的平台匹配规则 |
| `PAID_PROVIDER_PATTERNS` | `openai-compatible` | 整个平台强制按付费处理 |
| `FREE_MODEL_PATTERNS` | `:free,gemini-2.5-flash-lite` | 模型免费匹配规则 |
| `PAID_MODEL_PATTERNS` | 空 | 模型付费匹配规则 |

判定顺序采用安全优先：付费 Provider → 付费模型规则 → 模型目录明确付费 → 免费模型规则 → 免费 Provider → 模型目录明确免费 → 未知价格按付费处理。这样新发现的昂贵模型不会因为没有规则而消耗免费额度。

Zeabur AI Hub 的 `x-litellm-response-cost`、OpenRouter 的 `usage.cost` 和兼容费用字段会归一化；成功后按实际成本乘加成结算，未用冻结额度退回。平台没有可靠费用字段时按冻结上限扣除，避免 Bot 经营者承担未知费用。详细商品格式见 [STARS_PAYMENTS.md](STARS_PAYMENTS.md)。

## 15. Agent 与 GitHub App

主 Bot 侧变量：

| 变量 | 状态 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `AGENT_ENABLED` | 可选 | `false` | 可执行 Agent 总开关 |
| `AGENT_MAX_TASK_USD` | 条件必填 | `5` | 单任务最大美元预算 |
| `AGENT_MAX_RUNTIME_MINUTES` | 可选 | `60` | 单任务最长运行时间，范围 `1–1440` 分钟 |
| `AGENT_WORKER_URL` | 条件必填 | 空 | 独立 Worker HTTPS 地址；开发允许 localhost HTTP |
| `AGENT_WORKER_SECRET` | 条件必填 | 空 | Bot 与 Worker 共用的 HMAC 密钥，至少 32 字符 |
| `PUBLIC_BASE_URL` | 条件必填 | 空 | Bot 公网 HTTPS 地址，用于 OAuth 回调 |
| `GITHUB_APP_CLIENT_ID` | 条件必填 | 空 | GitHub App Client ID |
| `GITHUB_APP_CLIENT_SECRET` | 条件必填 | 空 | GitHub App Client Secret |
| `GITHUB_APP_SLUG` | 推荐 | 空 | GitHub App slug，用于安装链接 |
| `GITHUB_APP_CALLBACK_PATH` | 可选 | `/auth/github/callback` | OAuth 回调路径 |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | 条件必填 | 空 | GitHub 用户 Token 专用加密密钥 |

启用 `AGENT_ENABLED=true` 时还必须配置 `BILLING_USD_PER_CHAT_CREDIT`、HTTPS Worker、强 `AGENT_WORKER_SECRET`、HTTPS `PUBLIC_BASE_URL` 和完整 GitHub App。`GITHUB_TOKEN_ENCRYPTION_KEY` 必须是独立密钥，不能等于 `CHAT_ENCRYPTION_KEY`，也不能用聊天密钥兜底。

Agent、GitHub App 和 Worker 的真实部署说明见 [PAID_AGENT_GITHUB.md](PAID_AGENT_GITHUB.md)。

## 16. Agent Worker 专用环境变量

这些变量配置在独立 VPS 的 `agent-worker` 服务，不放在 Zeabur Bot 服务中：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `8080` | Worker HTTP 端口 |
| `AGENT_WORKER_SECRET` | 空 | 与 Bot 完全相同的 HMAC 密钥，至少 32 字符 |
| `SANDBOX_IMAGE` | `node:22-alpine` | Node 任务容器镜像 |
| `SANDBOX_GIT_IMAGE` | `alpine/git:v2.47.2` | Git 克隆镜像 |
| `SANDBOX_ALLOWED_IMAGES` | `node:22-alpine,python:3.13-alpine` | 允许使用的沙箱镜像白名单 |
| `SANDBOX_ALLOWED_COMMANDS` | `node,npm,npx,python,python3,pytest` | 可直接执行的命令白名单 |
| `SANDBOX_ALLOW_SHELL` | `false` | 是否允许 `sh/bash` 等 shell；生产保持关闭 |
| `WORKSPACE_ROOT` | `/workspaces` | Worker 容器内工作区根目录 |
| `WORKSPACE_HOST_ROOT` | 同上 | Docker daemon 实际可见的宿主机路径 |
| `WORKER_MAX_BODY_BYTES` | `4194304` | Worker 请求体上限，最少 64 KiB |
| `SANDBOX_MAX_WORKSPACE_BYTES` | `536870912` | 单任务工作区大小上限，最少 10 MiB |
| `SANDBOX_MAX_CONCURRENT_RUNS` | `2` | 同时运行的任务数，范围 `1–16` |
| `SANDBOX_RUN_TIMEOUT_MS` | `120000` | 单次命令超时，最少 10 秒 |
| `SANDBOX_PREPARE_TIMEOUT_MS` | `300000` | 克隆与安装依赖超时，最少 30 秒 |

Worker 会使用 Docker socket，因此 Worker 主机本身必须专用。沙箱容器默认无网络、只读根文件系统、删除全部 Linux capabilities、启用 `no-new-privileges`，并限制 CPU、内存、PID、文件描述符和临时目录。真实安全仍依赖 Docker daemon、宿主机补丁和网络边界，不能把 Worker 与 Bot 数据库或生产密钥放在同一台主机。

## 17. Admin API、访问控制和群组

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `ADMIN_API_ENABLED` | `false` | 独立管理 API 总开关 |
| `ADMIN_API_PORT` | `3001` | 管理 API 监听端口 |
| `ADMIN_API_PREFIX` | `/admin/api/v1` | 管理 API 路径前缀 |
| `ADMIN_API_TOKEN` | 空 | 开启管理 API 时必填的随机 Token，至少 32 字符 |
| `ALLOWED_USER_IDS` | 空 | 主 Bot 用户白名单；非空时只允许列表用户 |
| `ALLOWED_CHAT_IDS` | 空 | 允许的聊天 ID 列表 |
| `BLOCKED_USER_IDS` | 空 | 静态用户黑名单 |
| `GROUP_TRIGGER_MODE` | `smart` | 群聊触发方式 |
| `GROUP_TRIGGER_KEYWORD` | `ai` | 关键词触发模式使用的关键词 |

普通 Zeabur 部署应保持 `ADMIN_API_ENABLED=false`。如果启用，应使用反向代理/私网限制来源；仅有长 Token 不等于完整的网络边界。

管理员更改“全局默认模型”只影响仍使用自动模式的用户；每个用户的模型选择、运行状态、消息统计、AI 调用、余额和 Agent 任务都按 Telegram 用户 ID 独立保存，不会把一个用户操作扇出到所有用户私聊。

## 18. Mini App、Inline、Guard、Secretary 与新闻

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `MINI_APP_ENABLED` | `true` | Telegram Mini App 总开关 |
| `MINI_APP_AUTH_MAX_AGE_SECONDS` | `3600` | Telegram initData 最大有效时间 |
| `ENABLE_SECRETARY_AUTO_REPLY` | `true` | Secretary 获得权限后是否自动回复 |
| `GUARD_DEFAULT_ACTION` | `queue` | `queue` 审核、`approve` 开放、`decline` 严格 |
| `BOT_COLLABORATION_COOLDOWN_MS` | `5000` | Bot-to-Bot 同群最短回复间隔 |
| `INLINE_QUERY_DEBOUNCE_MS` | `1200` | 用户停止输入后再处理最后一个 Inline Query |
| `INLINE_QUERY_MIN_CHARS` | `2` | 过短查询只提示，不调用 AI 或搜索 |
| `INLINE_QUERY_RESPONSE_TIMEOUT_MS` | `8000` | Inline 总响应预算 |
| `INLINE_QUERY_SEARCH_TIMEOUT_MS` | `2300` | Inline 搜索预算 |
| `INLINE_QUERY_AI_ATTEMPT_TIMEOUT_MS` | `2200` | 单个模型尝试预算 |
| `INLINE_QUERY_CACHE_TTL_MS` | `60000` | 单用户相同查询缓存时间 |
| `NEWS_REGION` | `MY` | 新闻地区，两位国家代码 |
| `NEWS_LANGUAGE` | `auto` | 新闻语言，`auto` 跟随用户 |
| `NEWS_TIME_ZONE` | `Asia/Kuala_Lumpur` | 新闻时间显示时区 |

Inline、Guest、Guard、Secretary 和 Bot-to-Bot 能力还必须在 BotFather / Telegram 侧为 Bot 开启。第三方 Inline、Guest 和 Secretary 原文不会写入普通聊天记录或长期记忆。

主 Bot 群里的 `/help` 和 `/whoami` 会优先使用 Telegram 私密回复能力；如果 Telegram/API 不支持，会直接给调用用户发送主 Bot 私聊入口，不会公开群成员的用户 ID、余额、套餐或订单信息。

## 19. 端口、健康检查和平台变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | 平台注入或 3000 | Zeabur / Worker 服务端口 |
| `HEALTH_PORT` | `PORT` 或 `3000` | 主 Bot HTTP、Mini App、OAuth 和健康检查端口 |
| `HEALTHCHECK_TIMEOUT_MS` | `3000` | Docker 健康检查脚本超时 |

主 Bot HTTP 路由包括 `/ready`、可选 `/health`、Mini App `/app` 与 GitHub OAuth 回调。`/ready` 用于平台就绪探针，不应因为关闭公开健康信息而禁用。

`ZEABUR_SERVICE_ID`、`ZEABUR_PROJECT_ID`、`ZEABUR_ENVIRONMENT_ID` 由 Zeabur 自动注入，不要手动伪造。它们只用于识别部署环境和安全诊断。

## 20. 兼容变量与不应手动设置的变量

| 变量 | 说明 |
| --- | --- |
| `AI_PROVIDER` | 旧默认 Provider 入口；新部署使用 `DEFAULT_AI_PROVIDER` |
| `AI_MODEL` / `AI_FALLBACK_MODELS` | 对 `openai-compatible` 仍是正式模型配置，同时兼容旧单 Provider 部署 |
| `DAILY_QUOTA` | 旧聊天免费额度；新部署使用 `STARS_FREE_CHAT_DAILY` |
| `GITHUB_TOKEN` | GitHub Models Key 旧别名，不是 GitHub App 用户 Token |
| `HF_TOKEN` | Hugging Face Key 旧别名 |
| `DOCKER_LOG` | Docker 内部诊断使用，不是业务配置 |
| `PHASE_G_LOAD_LOOPS` / `PHASE_G_LOAD_THRESHOLD_MS` | 发布负载测试变量，不是生产功能变量 |
| `PATH` | 操作系统变量，不要覆盖 |

## 21. 常见启动失败与对应处理

| 日志/现象 | 原因 | 处理 |
| --- | --- | --- |
| `Production requires CHAT_ENCRYPTION_REQUIRED=true` | 生产关闭了强制加密 | 设置为 `true` |
| `CHAT_ENCRYPTION_KEY ... at least 32 characters` | 密钥为空、太短或仍是示例值 | 生成强随机密钥；已有部署保留旧值 |
| `CHAT_ENCRYPTION_KEY_MISMATCH` | 当前密钥与数据库原密钥不同 | 恢复原密钥，不要继续写入数据库 |
| `Production requires ... LOG_PRIVACY_KEY` | 缺少稳定日志匿名密钥 | 生成一个与聊天密钥不同的新值 |
| `GITHUB_TOKEN_ENCRYPTION_KEY must be different` | GitHub 和聊天复用了同一密钥 | 生成第三个独立密钥 |
| `ADMIN_API_ENABLED=true requires ...` | 管理 Token 太短或为示例值 | 使用至少 32 位随机 Token，或关闭 Admin API |
| `AGENT_ENABLED=true requires ...` | Agent 的计费、Worker 或 GitHub App 配置不完整 | 补齐全部条件变量，否则保持关闭 |
| `MISSING_AI_PROVIDER_CONFIG` | 没有可用 Provider/Key/模型 | 检查默认 Provider 及对应 Key |
| `SUPPORT_BOT_TOKEN_CONFLICT` | 客服 Token 等于主 Token | 在 BotFather 创建第二个 Bot |

## 22. 安全修改环境变量的顺序

1. 先备份 `/data/bot-data.db`，记录当前 `CHAT_ENCRYPTION_KEY` 已存在但不要复制到工单或聊天。
2. 在 Zeabur Variables 中修改普通配置；Token 和密钥使用 Secret 变量。保存前检查 JSON、逗号和 URL。
3. 重新部署后先看 `/ready` 与 Runtime Logs，再用管理员账号做一次私聊、余额、客服和模型测试。

不要删除旧聊天密钥后“试一个新值”。如果不确定某变量是否需要改，先保持原值并查看 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。
