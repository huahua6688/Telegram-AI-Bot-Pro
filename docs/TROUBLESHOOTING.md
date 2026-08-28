# 故障排查

## 1. Zeabur BackOff / 容器反复重启

先查看 Runtime Logs 中的 `Invalid runtime configuration` 或启动诊断错误码。

| 错误 | 原因 | 处理 |
| --- | --- | --- |
| `MISSING_TELEGRAM_BOT_TOKEN` | `BOT_TOKEN` 缺失或仍是示例值 | 从 BotFather 复制有效 Token |
| `MISSING_AI_PROVIDER_CONFIG` | 默认 Provider 没有 Key/模型，或自动模式没有可用平台 | 检查 `DEFAULT_AI_PROVIDER` 与对应 `*_API_KEY` / 模型 |
| `INVALID_PORT` | `PORT` / `HEALTH_PORT` 不是有效端口 | Zeabur 使用 `8080` |
| `DATABASE_PATH_NOT_FOUND` | `/data` 未挂载或父目录不可写 | 创建 Volume 并检查 `DATABASE_FILE` |
| `GEMINI_LIVE_CONFIG_MISSING` | 开启 Live 但缺少独立 Key/模型 | 补齐配置或关闭 Live |
| `SUPPORT_BOT_TOKEN_CONFLICT` | 客服 Token 复用了主 Token | 在 BotFather 新建第二个 Bot |
| `MISSING_SUPPORT_ADMIN_IDS` | 配置客服 Bot 但没有客服管理员 | 填 `SUPPORT_ADMIN_IDS` |
| `Production requires CHAT_ENCRYPTION_REQUIRED=true` | 生产关闭加密 | 设置为 `true` |
| `CHAT_ENCRYPTION_KEY ... at least 32 characters` | 聊天密钥为空、太短或为占位值 | 新部署生成强密钥；旧部署恢复原密钥 |
| `CHAT_ENCRYPTION_KEY_MISMATCH` | 当前聊天密钥与数据库原密钥不同 | 立即恢复原值，不要用新值继续部署 |
| `Production requires ... LOG_PRIVACY_KEY` | 缺少日志隐私密钥 | 生成一个与聊天密钥不同的新值 |
| `GITHUB_TOKEN_ENCRYPTION_KEY must be different` | GitHub Token 密钥复用了聊天密钥 | 生成第三个独立值 |
| `ADMIN_API_ENABLED=true requires ...` | Admin Token 太短或为示例值 | 使用至少 32 位随机值，或关闭 Admin API |
| `AGENT_ENABLED=true requires ...` | Worker、计费或 GitHub App 未配置完整 | 补齐全部条件，或保持 `AGENT_ENABLED=false` |

Zeabur 会自动被识别为生产环境，因此即使没写 `NODE_ENV=production`，聊天加密和日志隐私密钥仍会检查。

## 2. 已有 `CHAT_ENCRYPTION_KEY`，升级后怎么填

不要生成新的聊天密钥。保持：

```env
CHAT_ENCRYPTION_REQUIRED=true
CHAT_ENCRYPTION_KEY=原来的值
LOG_PRIVACY_KEY=新生成的不同值
```

`LOG_PRIVACY_KEY` 可以在任意 VPS 执行下面命令生成：

```bash
openssl rand -base64 48
```

## 3. 私聊出现两条回复，之后流式回复消失

确认：

```env
ENABLE_STREAMING_REPLIES=true
ENABLE_NATIVE_DRAFT_STREAMING=false
```

`ENABLE_NATIVE_DRAFT_STREAMING=true` 会使用 Telegram 临时草稿；草稿完成后会消失，并需要另一条持久最终消息。这不是推荐的生产模式。

默认模式应只创建一条持久消息，并持续编辑同一个 `message_id`。如果仍然重复：

1. 确认部署的是包含单消息流式修复的最新分支/版本。
2. 检查是否运行了两个使用同一 `BOT_TOKEN` 的实例。
3. 检查 Zeabur 是否同时保留旧服务和新服务。
4. 记录一次更新的时间、用户 ID（可匿名）和两条 Telegram message ID 排查。

## 4. Telegram 加粗、斜体或引用输入报错

用户输入的 Telegram entities 不需要转换成 HTML 后再发送给模型。当前代码读取文本内容并保留安全上下文。

Bot 输出会按以下顺序降级：Rich Message → HTML/引用参数 → 普通文本/无引用。如果生产仍显示 `can't parse entities`、`message to be replied not found` 或 Rich Message 错误，先确认部署版本，再保存 Telegram API 错误码；不要关闭整个回答流程。

格式降级可能让样式变简单，但不应重复回复或中断 AI 调用。

## 5. 群内一次命令让多个用户收到私聊

这是 fan-out（一次事件错误扩散给多个用户）问题，不是正常私密回复。

当前设计要求：

- `/help`、`/whoami` 和购买入口只绑定当前 `ctx.from.id`。
- Telegram 私密接口失败时只返回当前用户的主 Bot deep link。
- 不遍历群成员，也不向缓存中的其他用户发送私聊。
- 用户流式任务、停止控制器、余额、模型和统计都按用户 ID 独立。

如果再次发生，立即停止生产实例，记录触发命令、群 ID、实际收到私聊的账号和部署 commit，再运行双用户回归测试。

## 6. 客服 Bot 在群里回复或建工单

客服 Bot 应完全静默。检查是否部署了旧版本，并确认：

- 群普通文字、图片、语音、文件、视频等没有回复。
- `@客服Bot` 和 `/support` 也没有回复。
- 管理员私聊没有收到群消息副本。
- 群消息没有进入客服限流或工单状态。

生产建议同时在 BotFather 开启 Privacy Mode，但应用层仍有 private-only 二次保护。

## 7. Gemini 429 / Provider 限额

`RESOURCE_EXHAUSTED` 通常表示当前 Key 的额度或频率限制。同一 Key 切换另一个 Gemini 模型不一定恢复。

真正跨平台回退示例：

```env
DEFAULT_AI_PROVIDER=auto
ENABLE_PROVIDER_FALLBACK=true
AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
```

每个平台都需要独立 Key。`AI_PROVIDER_MAX_RETRIES=1` 表示首次失败后最多再试一次，不是无限重试。

用户曾手动选择失效模型时，重新部署不会覆盖 SQLite 中的选择；让该用户在控制台恢复“自动”。

## 8. AI Hub 付费请求太贵

检查：

```env
PAID_PROVIDER_PATTERNS=openai-compatible
BILLING_USD_PER_CHAT_CREDIT=0.10
BILLING_COST_MARKUP=1.50
BILLING_MAX_REQUEST_USD=2
AI_MAX_OUTPUT_TOKENS=2048
```

不要把 `openai-compatible` 或昂贵 Claude/GPT 模型误加到免费规则。模型价格未知时应按付费处理。

单个已发出的 Provider 请求可能超过预算估算，特别是长上下文和高输出模型。需要同时限制输入、输出，并按最昂贵模型账单设置 Stars 套餐。

## 9. Stars 已扣但额度未到账

检查：

- 是否收到 Telegram `successful_payment`。
- 订单 `currency` 是否为 `XTR`。
- 付款金额、用户和订单状态是否匹配。
- `telegram_payment_charge_id` 是否已经处理。
- `/data/bot-data.db` 是否持久化。

让用户提供 Telegram ID、付款时间和可安全分享的付款凭证，不要索取密码、验证码、API Key 或完整银行卡信息。

## 10. 套餐或额度页面显示旧值

`STARS_PRODUCTS_JSON` 是唯一套餐源，六类免费额度由 `STARS_FREE_*_DAILY` 管理。修改后必须重新部署。

检查 Zeabur 是否有重复变量、旧服务、错误环境或 JSON 不是一行。主 Bot、Mini App 和管理员页不应另有页面常量。

## 11. GitHub 连接失败

检查：

```env
PUBLIC_BASE_URL=https://你的Bot域名
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_SLUG=
GITHUB_APP_CALLBACK_PATH=/auth/github/callback
GITHUB_TOKEN_ENCRYPTION_KEY=
```

Callback URL 必须与 GitHub App 后台完全一致。Token 加密密钥必须独立且至少 32 位。OAuth state 只能使用一次；重复打开旧回调链接应被拒绝。

## 12. Agent 无法启动

启用 Agent 需要同时满足：

- `AGENT_ENABLED=true`
- 付费额度美元换算已配置
- HTTPS `AGENT_WORKER_URL`
- 强 `AGENT_WORKER_SECRET`
- HTTPS `PUBLIC_BASE_URL`
- GitHub App Client ID/Secret
- 独立 `GITHUB_TOKEN_ENCRYPTION_KEY`
- 用户已连接 GitHub 且有购买余额

主 Bot 所在 Zeabur 不需要 Docker；执行任务需要独立 Worker VPS 的 Docker daemon。没有 Worker 时保持 Agent 关闭，普通聊天仍可运行。

## 13. 数据丢失

确认：

```env
DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json
```

并确认 Zeabur Volume 实际挂载 `/data`。不要只看环境变量；没有 Volume 的路径仍会随容器重建丢失。

## 14. `/status` 没权限

`/status` 是管理员命令。私聊发送：

```text
/whoami
```

把显示的用户 ID 加入 `ADMIN_USER_IDS`，重新部署。

## 15. Inline Query 超时

默认总预算 8 秒，搜索 2.3 秒，单模型尝试 2.2 秒。Inline Query ID 很快失效，不能无限等待模型。

稳定实时搜索建议配置 `BRAVE_SEARCH_API_KEY`。免密回退受服务器网络和上游页面变化影响，只提供尽力而为结果。

## 16. 本地验证失败

| 检查 | 含义 |
| --- | --- |
| `npm run check:secrets` | 发现疑似密钥、数据库或不应提交文件 |
| `npm run check:syntax` | JavaScript 语法错误 |
| `npm test` | 自动化测试失败 |
| `git diff --check` | 空白、冲突标记或补丁格式问题 |
| `npm run docker:verify` | Docker 构建或容器内诊断失败；需要 Docker daemon |

自动化测试通过不等于真实 Telegram、付费模型、Stars、GitHub OAuth 或 Docker Worker 实机通过。
