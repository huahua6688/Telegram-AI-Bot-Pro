# 付费模型、Agent 与 GitHub 接入

本页描述的是完整生产路径，不是“只选择一个高级模型就能执行服务器任务”。主 Bot、模型 Provider、GitHub App 和独立 Worker 是四个不同边界。

## 1. 先启用安全计费

系统将 Provider/模型分为 `free` 和 `paid`。默认将承载 Zeabur AI Hub 的 `openai-compatible` 整个平台设为付费；其他已经支持的 Provider 可继续使用每日免费次数，但平台目录明确标记为付费的模型仍然优先按付费处理。付费和价格未知的模型一律只能使用购买余额。

```env
BILLING_USD_PER_CHAT_CREDIT=0.10
BILLING_USD_PER_VISION_CREDIT=0.05
BILLING_USD_PER_IMAGE_CREDIT=0.10
BILLING_USD_PER_TTS_CREDIT=0.02
BILLING_USD_PER_LIVE_VOICE_CREDIT=0.02
BILLING_USD_PER_VIDEO_CREDIT=0.50
BILLING_COST_MARKUP=1.50
BILLING_MAX_REQUEST_USD=2
AI_MAX_OUTPUT_TOKENS=2048
FREE_MODEL_PATTERNS=:free,gemini-2.5-flash-lite
PAID_MODEL_PATTERNS=claude-opus,claude-sonnet,gpt-5
FREE_PROVIDER_PATTERNS=gemini,gemini-live,groq,openrouter,github-models,huggingface,mistral,openai,anthropic,deepseek,qwen,grok,glm,doubao
PAID_PROVIDER_PATTERNS=openai-compatible
```

聊天额度与三档套餐采用保守起步值：300 Stars/30 聊天额度、800 Stars/90 聊天额度、2000 Stars/240 聊天额度。按每个聊天额度 0.10 美元、1.5 倍成本加成计算，一次 1 美元的模型请求约扣 15 个额度。该示例不保证盈利；仍应定期对照 Telegram 实际结算、退款和 Provider 账单调整。某能力的换算值留空时，该能力的付费/未知成本模型会安全关闭。

请求开始前会冻结 `BILLING_MAX_REQUEST_USD` 对应的额度，并用 `AI_MAX_OUTPUT_TOKENS` 限制单次兼容接口的最大输出。Zeabur AI Hub 的 `x-litellm-response-cost` 和 OpenRouter 的 `usage.cost` 会被归一化；成功后按真实成本乘 `BILLING_COST_MARKUP` 结算，未使用额度自动退回。没有可靠费用字段的平台按冻结上限扣费，避免亏损。所有调用写入 `provider_usage_costs`。单个已经发出的 Provider 请求无法在费用达到美元阈值的瞬间被切断，因此上线前仍应按最昂贵模型的最大输入、最大输出成本设置冻结上限和 Stars 售价。

## 2. 多平台

Zeabur AI Hub 继续使用：

```env
DEFAULT_AI_PROVIDER=openai-compatible
AI_API_KEY=...
AI_BASE_URL=https://控制台给出的完整地址
AI_MODEL=平台中的模型ID
```

OpenRouter 作为第二平台：

```env
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/free
AI_PROVIDER_FALLBACK_ORDER=openai-compatible,openrouter
```

Provider、Agent、GitHub 和计费是独立模块。以后替换模型平台，只需修改 Provider Key、Base URL 和模型 ID；任务表、GitHub 授权与 Worker 不需要重做。免费请求的 fallback 只会进入免费模型，不能自动掉到付费模型。

## 3. 创建 GitHub App

在 GitHub Developer settings 创建 GitHub App：

- Homepage URL：Bot 公网地址。
- Callback URL：`https://你的域名/auth/github/callback`。
- Repository permissions：Metadata `Read-only`、Contents `Read and write`、Pull requests `Read and write`。
- Installation：允许用户仅选择需要授权的仓库。

然后设置：

```env
PUBLIC_BASE_URL=https://你的域名
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_TOKEN_ENCRYPTION_KEY=至少32位、且不能与聊天加密密钥相同的随机字符串
```

用户发送 `/github connect` 完成授权，`/github repos` 查看可访问仓库，`/github disconnect` 删除本地连接。令牌使用 AES-256-GCM 加密，并与 Telegram 用户 ID 绑定；系统不共用管理员的 GitHub Token。

生产还必须设置聊天与日志密钥：

```env
CHAT_ENCRYPTION_REQUIRED=true
CHAT_ENCRYPTION_KEY=保留现有值或新部署生成
LOG_PRIVACY_KEY=独立随机值
GITHUB_TOKEN_ENCRYPTION_KEY=第三个独立随机值
```

`GITHUB_TOKEN_ENCRYPTION_KEY` 不能等于聊天密钥，也不会自动回退到聊天密钥。更换后旧 GitHub Token 无法直接解密，通常需要用户重新授权或专门迁移。

## 4. 部署独立 Agent Worker

不要把陌生用户的命令放在 Bot 容器中执行。`agent-worker/` 是独立服务，收到 HMAC 签名请求后，再为每次命令启动一个无网络、只读根文件系统、限 CPU/内存/PID/文件描述符、删除全部 capabilities 的临时 Docker 容器。Shell 默认禁用；只有明确设置 `SANDBOX_ALLOW_SHELL=true` 并把 shell 加入 `SANDBOX_ALLOWED_COMMANDS` 才会开放。

在独立 VPS 上：

```bash
cd agent-worker
docker compose up -d --build
```

将 Worker 放在 HTTPS 反向代理或私网后，并在 Bot 与 Worker 两边设置相同的随机密钥：

```env
AGENT_ENABLED=true
AGENT_MAX_TASK_USD=5
AGENT_WORKER_URL=https://worker.example.com
AGENT_WORKER_SECRET=至少32位随机字符串
```

Worker 自己的推荐变量：

```env
PORT=8080
AGENT_WORKER_SECRET=与Bot端完全相同
SANDBOX_ALLOW_SHELL=false
SANDBOX_IMAGE=node:22-alpine
SANDBOX_GIT_IMAGE=alpine/git:v2.47.2
SANDBOX_ALLOWED_IMAGES=node:22-alpine,python:3.13-alpine
SANDBOX_ALLOWED_COMMANDS=node,npm,npx,python,python3,pytest
SANDBOX_MAX_CONCURRENT_RUNS=2
SANDBOX_MAX_WORKSPACE_BYTES=536870912
SANDBOX_RUN_TIMEOUT_MS=120000
SANDBOX_PREPARE_TIMEOUT_MS=300000
WORKER_MAX_BODY_BYTES=4194304
WORKSPACE_ROOT=/workspaces
WORKSPACE_HOST_ROOT=/var/lib/telegram-agent-worker
```

`WORKSPACE_HOST_ROOT` 必须是 Docker daemon 实际看到的宿主机路径。不要把 `sh`/`bash` 加进命令白名单；除非完成额外安全评审，也不要打开 `SANDBOX_ALLOW_SHELL`。

Docker socket 权限等同于 Worker 主机的高权限，因此这台机器必须专用于沙箱任务，不能与 Bot 数据库和模型 Key 共存。

## 5. Telegram 使用

```text
/github connect
/agent owner/repository 修复测试并创建 PR
```

Agent 只使用购买余额，先冻结任务预算，并持久记录 `queued / running / waiting_approval / paused / succeeded / failed / cancelled`。创建分支、写文件和创建 PR 都会通过 Telegram 按钮逐次确认；拒绝后任务取消并退回未结算额度。

Telegram Bot API 10.3 可用时，任务状态使用带颜色的 Rich Message 按钮；群聊中的状态、审批和报告只对任务本人可见。用户可暂停、继续、取消任务，也可在模型草稿上点击停止生成。完成、失败或取消后会发送 Markdown 报告，并以内嵌文档形式显示；旧客户端或不支持新接口的 Bot API 会自动退回普通消息和普通文件。

群管理员还可配置只对新成员本人可见的欢迎消息：

```text
/welcome set 欢迎 {name} 加入 {chat}
/welcome status
/welcome off
```

Bot 必须是群管理员并拥有“发送欢迎消息”权限；如果缺少权限，系统不会退回公开欢迎消息，避免群内刷屏。

## 6. 上线检查

1. 免费账号选择 Claude/未知模型时，请求在调用 Provider 前被拒绝。
2. 付费请求后检查 `provider_usage_costs` 的美元成本、token 和扣费额度。
3. 用两个 Telegram 账号验证 GitHub 授权互不相通。
4. 拒绝写文件审批，确认仓库没有变化且任务余额归还。
5. Worker 未配置或签名错误时，Agent 必须失败关闭，Bot 聊天仍可正常使用。

## 7. 当前验证边界

IMPLEMENTED：持久任务、状态事件、预算、暂停/继续/取消、Telegram 审批、GitHub OAuth state 防重放、加密 Token 与刷新、Worker 签名、路径/命令白名单和 Docker 安全参数。

BLOCKED（需要部署者环境）：真实 Docker daemon 容器端到端、真实 GitHub App OAuth/刷新、真实付费模型成本、真实仓库修改与 Draft PR。模拟 Worker 或 Mock GitHub 测试不能替代这些验证。
