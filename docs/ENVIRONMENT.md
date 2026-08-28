# 环境变量说明

优先参考：

    .env.zeabur.example

## 必填

    BOT_TOKEN            Telegram BotFather Token
    DEFAULT_AI_PROVIDER  默认 AI 提供商；推荐 auto
    GEMINI_API_KEY       Gemini API Key
    DEFAULT_AI_MODEL     默认模型；推荐 gemini-2.5-flash
    ADMIN_USER_IDS       Telegram 管理员 User ID

## 推荐

    ENABLE_PROVIDER_FALLBACK=true
    AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter,openai-compatible
    GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite
    AI_PROVIDER_MAX_RETRIES=1  首次失败后的额外重试次数；1 表示每个模型最多尝试 2 次
    TRANSLATION_MODEL    翻译模型
    ROUTER_MODEL         AI 路由模型
    PORT                 Zeabur 服务端口
    HEALTH_PORT          健康检查端口
    DATABASE_FILE        SQLite 数据库路径
    DATA_FILE            旧数据文件路径
    ADMIN_API_ENABLED    Admin API 开关

## 启动诊断与健康检查

```env
ENABLE_STARTUP_DIAGNOSTICS=true
SHOW_VERSION_INFO=true
HEALTH_CHECK_ENABLED=true
TELEGRAM_STARTUP_MAX_RETRIES=6
TELEGRAM_STARTUP_RETRY_BASE_MS=1000
TELEGRAM_STARTUP_RETRY_MAX_MS=30000
```

- `ENABLE_STARTUP_DIAGNOSTICS`：启动前检查 Node.js、应用版本、Git commit（可读取时）、部署环境、主 Bot Token、AI Provider、数据库路径和端口。缺少关键配置时会使用稳定错误码停止启动。
- `SHOW_VERSION_INFO`：控制管理员菜单中的版本信息入口；版本页只显示安全的构建和运行信息。
- `HEALTH_CHECK_ENABLED`：控制公开 `/health` 接口。关闭后 `/health` 返回 404，但 `/ready` 继续供 Zeabur / Docker 就绪探针使用。
- `TELEGRAM_STARTUP_*`：Telegram 临时超时、网络错误或 429 时按退避策略重试；无效 Token 等永久错误不会反复重试。

日志不会输出完整 Token、API Key 或密码；诊断展示敏感值时只保留前 4 位和后 4 位。

## 客服 Bot

```env
SUPPORT_ENABLED=true
SUPPORT_BOT_TOKEN=
SUPPORT_BOT_USERNAME=
SUPPORT_CONTACT_URL=
SUPPORT_ADMIN_IDS=
SUPPORT_RATE_LIMIT_WINDOW_MS=60000
SUPPORT_RATE_LIMIT_MAX_MESSAGES=6
```

- `SUPPORT_BOT_TOKEN` 必须来自 BotFather 的第二个 Bot，不能与主 `BOT_TOKEN` 相同。
- `SUPPORT_ADMIN_IDS` 是可处理客服消息的 Telegram 数字 ID，多个 ID 使用英文逗号分隔。
- `SUPPORT_CONTACT_URL` 有值时优先作为“联系客服”按钮目标；否则由 `SUPPORT_BOT_USERNAME` 生成 `https://t.me/<username>?start=support`。
- 只配置外部客服链接而不启动第二个 Bot 时，`SUPPORT_BOT_TOKEN` 可以留空。
- 客服 Bot 支持文字、图片、语音和文件，并带窗口限流；管理员必须回复带工单标记的转发消息才能答复对应用户。客服正文和管理员回复关系不写入 SQLite，工单关闭、超时或服务重启后从内存清除。

## 免费额度与 Stars 商品

每日免费额度由六个 `STARS_FREE_*_DAILY` 变量统一管理。内部键 `live_voice` 当前对应“语音转写”，不是双向实时语音；视频处理链尚未实现，因此视频额度不会出售。`DAILY_QUOTA=20` 只保留为旧聊天配置的兼容回退。

商品包只从 `STARS_PRODUCTS_JSON` 读取。主 Bot、Mini App 和管理员页面都会使用同一份配置，避免出现不同页面显示旧额度。完整三档示例见 [Telegram Stars 支付与用量计费](STARS_PAYMENTS.md)。

## Smart AI Router

Smart AI Router 会按任务类型选择已配置的目标模型。它默认开启：

```env
SMART_ROUTING_ENABLED=true
SMART_ROUTING_DEBUG=false
SMART_ROUTING_MIN_CONFIDENCE=0.55
```

- `SMART_ROUTING_ENABLED=false`：跳过 Smart 任务路由，直接使用后续的默认 Provider / 模型流程。
- `SMART_ROUTING_DEBUG=true`：输出路由诊断信息，适合部署调试；日常使用建议关闭。
- `SMART_ROUTING_MIN_CONFIDENCE`：接受 Smart 规则结果的最低置信度，默认 `0.55`；配置会安全限制在 `0` 到 `1`，无效值回到默认值。

可配置的任务路由如下。模型 ID 必须从对应 Provider 控制台复制；模板不内置或猜测新的模型 ID：

```env
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
```

路由键分别对应通用聊天、翻译、代码、推理、长上下文、文档、视觉、OCR、工具调用和低成本任务。

### 优先级与配置规则

请求选择顺序为：

1. 用户明确选择的模型
2. 用户明确选择的 Provider
3. 翻译、视觉/媒体等专用功能或模式的 Provider + 模型；需要时这些模式会绕过 Smart 路由
4. Smart 规则命中的任务目标
5. 默认 Provider + 模型
6. 请求失败后，按原有顺序尝试同 Provider 的备用模型，再按 `AI_PROVIDER_FALLBACK_ORDER` 跨 Provider 回退

Smart 路由只决定首次目标，不会改变 `ENABLE_PROVIDER_FALLBACK`、备用模型列表、重试次数或跨 Provider 回退顺序。

免费优先、付费兜底时使用 `DEFAULT_AI_PROVIDER=gemini`，并把 `openai-compatible` 放在 `AI_PROVIDER_FALLBACK_ORDER` 最后。AI Hub 即使不是默认平台仍会同步模型；免费平台返回 429、额度耗尽、模型不可用、超时或临时错误后，会继续尝试下一个平台。用户选择“自动”时会自动恢复故障切换。

- `DEFAULT_AI_PROVIDER=auto` 时，每个非空的 `ROUTER_*_MODEL` 都必须同时配置对应的具体 `ROUTER_*_PROVIDER`。只填模型无法安全判断它属于哪个平台。
- `DEFAULT_AI_PROVIDER` 是固定、非 `auto` Provider 时，`ROUTER_*_PROVIDER` 可以留空；对应任务模型会归入这个固定 Provider，同一个 Key / 网关可以使用多个模型。
- Provider 别名会规范化，例如 `google` → `gemini`、`claude` → `anthropic`、`custom` → `openai-compatible`。

### 与旧 AI intent router 的区别

`ENABLE_AI_ROUTER`、`AI_ROUTER_MODE`、`ROUTER_PROVIDER` 和 `ROUTER_MODEL` 属于旧的 LLM intent router：它调用专用模型判断意图。`SMART_ROUTING_*` 和 `ROUTER_<TASK>_*` 属于新的按任务选模型功能。两套变量不是别名，旧变量的行为保持不变，也可以继续独立使用。

### AI Hub / OpenAI-compatible 网关

AI Hub 按标准 OpenAI-compatible Provider 配置，不使用代码内置的 Zeabur URL：

```env
DEFAULT_AI_PROVIDER=openai-compatible
AI_API_KEY=
AI_BASE_URL=
AI_MODEL=
MODEL_DISCOVERY_ENABLED=true
MODEL_LIST_CACHE_TTL_MS=3600000
```

When the AI Hub supports OpenAI-compatible `GET /models`, model-name variables may stay empty for discovery. The bot synchronizes the catalog at startup and administrators can refresh it from the Mini App. In fixed-provider mode, an unknown-price model still requires manual selection. In automatic cross-provider mode, an explicitly configured AI Hub at the end of `AI_PROVIDER_FALLBACK_ORDER` may use a discovered chat model only after earlier providers are unavailable; this can incur charges, so remove `openai-compatible` from the fallback order if automatic paid fallback is not desired. Free models are tried before paid or unknown-price models. Provider metadata is displayed when available; otherwise inferred uses are explicitly labeled. Non-chat embedding, rerank, TTS, image, and video models are routed to their matching capabilities instead of the chat selector.

Enable Telegram-native rich rendering for long structured private-chat replies with:

```env
ENABLE_RICH_MESSAGES=true
RICH_MESSAGE_MIN_CHARS=600
ENABLE_STREAMING_REPLIES=true
ENABLE_NATIVE_DRAFT_STREAMING=false
STREAMING_EDIT_INTERVAL_MS=350
```

News results in private chat and inline mode use Telegram Rich Messages even when the digest is short. Other short replies, group replies, and unsupported/failed rich-message requests automatically use the existing regular message path.

With streaming replies enabled, Gemini and OpenAI-compatible providers request an SSE response. Private chats create one persistent Telegram message and edit that same message as fragments arrive; completion edits the same `message_id`, so users do not briefly see both a temporary draft and a second final reply. Rich fragments use persistent `sendRichMessage` plus `editMessageText.rich_message`, while unsupported or malformed rich content falls back to regular text edits on the same message. A per-request stop button aborts only that user's matching model request. Updates are rate-limited by `STREAMING_EDIT_INTERVAL_MS`. Set `ENABLE_NATIVE_DRAFT_STREAMING=true` only if Telegram's temporary `sendRichMessageDraft` / `sendMessageDraft` lifecycle is explicitly preferred; native drafts disappear after completion and the final answer is a separate persistent message. Group replies and providers without streaming support use a regular complete reply.

请把 AI Hub 控制台提供的完整 API Base URL 填入 `AI_BASE_URL`。固定使用 `openai-compatible` 时，可以保持各 `ROUTER_*_PROVIDER` 为空，只填写该 Hub 实际支持的任务模型 ID；所有这些模型会共用同一个 `AI_API_KEY` 和 `AI_BASE_URL`。如果默认 Provider 为 `auto`，则每组任务配置都应显式写 `ROUTER_*_PROVIDER=openai-compatible`。

Gemini Live 仍只走 Google 官方 Gemini Live API，并使用独立的 `GEMINI_LIVE_API_KEY` 与兼容 Live 模型。第三方 OpenAI-compatible Hub 不能冒充 `gemini-live`；实时语音等专用模式需要时会绕过 Smart 路由。

## 隐私与下载安全

```env
CONVERSATION_RETENTION_DAYS=30
PRIVACY_SWEEP_INTERVAL_HOURS=24
MINI_APP_SHOW_USER_MESSAGES=false
TELEGRAM_FILE_MAX_BYTES=10485760
TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS=20000
```

- 默认只在 Mini App 历史和管理员会话详情中返回 AI 回复，不返回用户输入；确有支持需要时才显式开启 `MINI_APP_SHOW_USER_MESSAGES`。
- 结构化运行日志默认移除消息正文、提示词、用户名、IP、User-Agent、异常正文/堆栈和密钥，并用仅在当前进程内稳定的匿名标识替代用户关联 ID；日志仍保留 Provider、错误类型、错误码和计数，便于排障。
- Admin API 的 JSON 请求体上限为 64 KB，所有 JSON/CSV 响应带 `no-store`；内部错误不会返回原始异常消息，失败审计只记录路由路径和稳定错误码。
- 对话超过保留天数后自动删除，`0` 表示关闭自动清理。用户资料、Stars 订单、余额和用量账目不会被这项清理误删。
- Telegram 文件下载会在下载前检查声明大小，并在流式下载过程中再次执行大小和超时限制。
- `fetch_url` 只允许公开的 HTTP/HTTPS 80/443 地址；本机、内网、链路本地、云元数据、保留地址和不安全重定向都会被拒绝，响应正文上限为 1 MB。
- `TOOL_MAX_CONCURRENT_CALLS` 默认 `8`，限制单个 Bot 进程同时执行的联网工具数量；高峰时超出的调用会返回可重试的忙碌状态，由 Agent 改用其他方案或稍后重试，避免搜索洪峰拖垮全部对话。

## Telegram 扩展模式

代码已支持 Inline Mode、Guest Chat Mode、Guard Mode、Secretary Mode 和 Bot-to-Bot Communication。
这些平台能力还必须在 BotFather 的 Bot Settings 中为当前 Bot 开启；`/help` 下方按钮会显示 Telegram 返回的实际能力状态。

    ENABLE_SECRETARY_AUTO_REPLY=true   Secretary 连接获得回复权限后自动答复
    GUARD_DEFAULT_ACTION=queue          Guard 初始模式：queue 审核 / approve 开放 / decline 严格
    BOT_COLLABORATION_COOLDOWN_MS=5000  同一 Bot 在同一群的最短回复间隔
    INLINE_QUERY_DEBOUNCE_MS=1200        停止输入多久后处理最后一条 Inline Query
    INLINE_QUERY_MIN_CHARS=2             少于此字符数只提示继续输入，不调用搜索或 AI
    INLINE_QUERY_RESPONSE_TIMEOUT_MS=8000 Inline Query 从收到到回复 Telegram 的总预算
    INLINE_QUERY_SEARCH_TIMEOUT_MS=2300   Inline 联网预取的最大等待时间
    INLINE_QUERY_AI_ATTEMPT_TIMEOUT_MS=2200 单个 AI 模型尝试的最大等待时间
    INLINE_QUERY_CACHE_TTL_MS=60000     相同 Inline 问题的个人缓存时间
    BRAVE_SEARCH_API_KEY=               稳定实时搜索建议配置；免密搜索仅为尽力而为的回退

真正跨平台回退需要为顺序中的备用平台分别配置独立 Key，例如 `GROQ_API_KEY` 和 `OPENROUTER_API_KEY`；只配置 Gemini Key 时，Gemini 额度耗尽后无法切换到其他平台。

Guest、Inline 和 Secretary 收到的第三方原文不会写入普通聊天记录或长期记忆。Guard 默认采用安全策略：黑名单拒绝、白名单/管理员通过、其他请求排队人工审核。

Guard 模式和动态名单保存在 SQLite：管理员可在 `/help` → `Guard Mode` 中选择“审核 / 开放 / 严格”，并使用按钮管理名单，也可发送 `/allow 用户ID`、`/disallow 用户ID`、`/block 用户ID`、`/unblock 用户ID`。黑名单始终优先拒绝，白名单和管理员始终优先通过，模式只决定其他用户的处理方式。

Bot 作为群管理员时会显式订阅 `chat_member` 更新：Telegram 将成员状态标记为 `kicked` 时自动加入动态黑名单，从 `kicked` 解除时自动移出。Telegram Bot API 不提供一次性读取群组完整“已移除用户”名单的接口，因此自动同步从部署并收到更新后开始；普通 `left`（包括主动退群）不会被误判为黑名单。`BLOCKED_USER_IDS` 和 `ALLOWED_USER_IDS` 仍是部署环境里的静态名单；其中 `ALLOWED_USER_IDS` 非空时也会限制普通 Bot 的访问范围，若只想控制 Guard，优先使用动态名单按钮或命令。

## Live API

普通部署先关闭：

    ENABLE_LIVE_AUDIO=false
    ENABLE_LIVE_TRANSLATE=false

这两个功能使用独立的 `GEMINI_LIVE_API_KEY` 和兼容模型；普通 `GEMINI_API_KEY` 不会自动开放 Live 功能。
