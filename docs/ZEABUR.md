# Zeabur 部署指南

## 1. 创建服务

在 Zeabur 选择 GitHub 仓库部署：

- Repository：`huahua6688/Telegram-AI-Bot-Pro`
- Build：根目录 `Dockerfile`
- Service type：HTTP
- Port：`8080`
- Node.js：镜像已固定 Node 22，不需要额外 Build Command

不要把 Agent Worker 一起部署在主 Bot 容器中。普通 Bot 只需要 Zeabur；只有开启可执行 Agent 时才需要独立 VPS Worker。

## 2. 创建持久化 Volume

创建 Volume 并挂载：

```text
/data
```

环境变量：

```env
DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json
```

没有 `/data` 持久化卷，重新部署或重建容器后可能丢失用户设置、会话、额度、订单、GitHub 授权和 Agent 任务。

## 3. 复制环境变量模板

以 `.env.zeabur.example` 为完整模板。不要把模板里的空值理解为全部必填；详细条件见 [环境变量完整说明](ENVIRONMENT.md)。

新部署的基础配置：

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
ENABLE_STARTUP_DIAGNOSTICS=true
HEALTH_CHECK_ENABLED=true
SHOW_VERSION_INFO=true
ENABLE_NATIVE_DRAFT_STREAMING=false
ADMIN_API_ENABLED=false
AGENT_ENABLED=false
```

至少配置一个真实可用的 AI Provider。使用 Zeabur AI Hub 时，不需要 Gemini Key，改用第 5 节的配置。

## 4. 生成和保存生产密钥

在任意 Linux / macOS 终端分别执行两次：

```bash
openssl rand -base64 48
```

两个输出分别放入：

```env
CHAT_ENCRYPTION_KEY=第一个随机值
LOG_PRIVACY_KEY=第二个随机值
```

两个值必须不同，并在 Zeabur 中作为 Secret 保存。

已有部署如果已经存在 `CHAT_ENCRYPTION_KEY`：

- 保持原值不动。
- 只新增不同的 `LOG_PRIVACY_KEY`。
- 确认 `CHAT_ENCRYPTION_REQUIRED=true`。
- 不要删除旧 Key 后重新生成，否则历史数据无法解密。

## 5. AI Provider 选择

### Gemini

```env
DEFAULT_AI_PROVIDER=gemini
DEFAULT_AI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite
```

### Zeabur AI Hub / 其他 OpenAI-compatible 网关

```env
DEFAULT_AI_PROVIDER=openai-compatible
AI_API_KEY=
AI_BASE_URL=AI Hub控制台给出的完整地址
AI_MODEL=AI Hub控制台中的准确模型ID
MODEL_DISCOVERY_ENABLED=true
```

项目不会硬编码 AI Hub 地址。`AI_API_KEY` 只适用于你填写的 `AI_BASE_URL`，不能直接拿去其他平台。

### 多平台自动回退

```env
DEFAULT_AI_PROVIDER=auto
ENABLE_PROVIDER_FALLBACK=true
AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter,openai-compatible
AI_PROVIDER_MAX_RETRIES=1
```

顺序中的每个平台都必须有自己的 Key。没有 Key 的平台不会提供真实回退能力。

## 6. 客服 Bot

先在 BotFather 创建第二个 Bot：

```env
SUPPORT_ENABLED=true
SUPPORT_BOT_TOKEN=第二个Bot Token
SUPPORT_BOT_USERNAME=不带@的用户名
SUPPORT_ADMIN_IDS=客服Telegram数字ID
SUPPORT_SUPER_ADMIN_IDS=
SUPPORT_TICKET_AUTO_CLOSE_MINUTES=1440
```

`SUPPORT_BOT_TOKEN` 不能等于主 `BOT_TOKEN`。客服 Bot 只处理私聊；加入群组、超级群组或频道后对所有内容保持静默。

只想使用外部客服链接时：

```env
SUPPORT_CONTACT_URL=https://你的客服地址
SUPPORT_BOT_TOKEN=
```

## 7. Stars 与付费模型

必须在环境变量中设置一行 `STARS_PRODUCTS_JSON`。商品、价格和赠送额度不会从代码自动猜测。推荐从 `.env.zeabur.example` 复制当前保守套餐，再按真实模型账单调整。

付费/未知模型至少需要：

```env
BILLING_USD_PER_CHAT_CREDIT=0.10
BILLING_COST_MARKUP=1.50
BILLING_MAX_REQUEST_USD=2
AI_MAX_OUTPUT_TOKENS=2048
PAID_PROVIDER_PATTERNS=openai-compatible
```

未设置某能力的 `BILLING_USD_PER_*_CREDIT` 时，该能力的付费/未知模型会安全关闭。详情见 [Telegram Stars 支付与计费](STARS_PAYMENTS.md)。

## 8. Admin API

普通部署保持关闭：

```env
ADMIN_API_ENABLED=false
```

只有确实存在外部管理后台时才开启：

```env
ADMIN_API_ENABLED=true
ADMIN_API_TOKEN=至少32位强随机值
```

同时使用防火墙、私网或反向代理限制 3001 端口来源，不要直接暴露公网。

## 9. Agent 与 GitHub

默认：

```env
AGENT_ENABLED=false
```

启用时必须同时完成：独立 VPS Worker、HTTPS、强 Worker 密钥、付费额度换算、GitHub App、独立 GitHub Token 加密密钥。只把 `AGENT_ENABLED` 改为 `true` 会因配置不完整拒绝启动。

完整步骤见 [付费模型、Agent 与 GitHub](PAID_AGENT_GITHUB.md)。

## 10. 健康检查

主服务提供：

- `/ready`：Zeabur 就绪探针，始终保留。
- `/health`：安全运行状态，可用 `HEALTH_CHECK_ENABLED=false` 关闭。
- `/status`：增强状态信息。
- `/app`：Telegram Mini App。

Zeabur 健康检查建议使用：

```text
/ready
```

## 11. 首次部署后验证

1. Runtime Logs 不出现 `Invalid runtime configuration`，`/ready` 返回成功。
2. 私聊主 Bot 发送 `/whoami`，核对 `ADMIN_USER_IDS`。
3. 发送普通问题，确认只有一条持续编辑的回复，完成后不消失。
4. 打开控制台，核对 Provider、模型、免费额度和套餐。
5. 如启用客服，用普通账号私聊客服 Bot 建工单；在群中发送任何客服消息应完全静默。

Telegram 10.3、购买隐私和双用户隔离见 [手机实机测试清单](TELEGRAM_10_3_MOBILE_TEST.md)。

## 12. 更新已有部署

安全顺序：

1. 备份 `/data/bot-data.db`，确认原 `CHAT_ENCRYPTION_KEY` 仍存在。
2. 合并/拉取代码并同步新增环境变量，不覆盖 Token、Key 和数据库路径。
3. 重新部署，检查 `/ready`、Runtime Logs，再做私聊、额度和客服测试。

Zeabur 环境变量和 Volume 会跨部署保留。代码更新不会自动替换用户已经保存在 SQLite 中的个人模型选择；需要时让用户在控制台恢复“自动”。
