# 部署前检查清单

## 1. 代码检查

- [ ] 当前不是直接修改生产 `main` 的未审查工作区。
- [ ] `npm test` 全部通过。
- [ ] `npm run check:syntax` 通过。
- [ ] `npm run check:secrets` 通过。
- [ ] `git diff --check` 通过。
- [ ] 有 Docker daemon 时运行 `npm run docker:verify`。
- [ ] 没有真实 Docker / Telegram / Provider 测试时，在发布说明中标记 BLOCKED。

## 2. 数据备份

- [ ] Zeabur Volume 已挂载到 `/data`。
- [ ] `DATABASE_FILE=/data/bot-data.db`。
- [ ] 部署前已备份当前 SQLite。
- [ ] 已确认现有 `CHAT_ENCRYPTION_KEY` 保持原值。
- [ ] 没有把数据库、`.env` 或密钥加入提交。

## 3. 生产安全变量

```env
NODE_ENV=production
CHAT_ENCRYPTION_REQUIRED=true
CHAT_ENCRYPTION_KEY=
LOG_PRIVACY_KEY=
ENABLE_NATIVE_DRAFT_STREAMING=false
ADMIN_API_ENABLED=false
```

- [ ] `CHAT_ENCRYPTION_KEY` 至少 32 位，已有部署没有更换。
- [ ] `LOG_PRIVACY_KEY` 至少 32 位，与聊天密钥不同。
- [ ] Token 和密钥均保存在 Zeabur Secret Variables。
- [ ] 如启用 GitHub App，使用第三个不同的 `GITHUB_TOKEN_ENCRYPTION_KEY`。
- [ ] 如启用 Admin API，`ADMIN_API_TOKEN` 至少 32 位且端口不直接暴露公网。

## 4. 主 Bot 与 Provider

- [ ] `BOT_TOKEN` 是主 Bot 的有效 BotFather Token。
- [ ] `ADMIN_USER_IDS` 包含正确 Telegram 数字 ID。
- [ ] `DEFAULT_AI_PROVIDER` 与实际 Key 匹配。
- [ ] 默认模型 ID 来自当前 Provider 控制台，不是猜测值。
- [ ] `AI_PROVIDER_FALLBACK_ORDER` 中每个平台都有独立 Key；没有 Key 的平台已移除。
- [ ] AI Hub 使用 `openai-compatible`、准确 `AI_BASE_URL` 和模型 ID。
- [ ] 昂贵/未知模型不会被 `FREE_*_PATTERNS` 误判为免费。

## 5. 客服 Bot

- [ ] `SUPPORT_BOT_TOKEN` 与 `BOT_TOKEN` 不同。
- [ ] `SUPPORT_ADMIN_IDS` 至少有一个有效客服 ID。
- [ ] 群组、超级群组和频道内客服 Bot 对文字、媒体、提及和命令完全静默。
- [ ] 私聊普通可复制消息可以建工单并由正确客服回复。
- [ ] 两个用户的工单和消息引用不会串联。

## 6. Stars 与额度

- [ ] `STARS_PRODUCTS_JSON` 是一行有效 JSON。
- [ ] 主 Bot、Mini App 和管理员页面使用相同套餐。
- [ ] 六类 `STARS_FREE_*_DAILY` 符合当前运营规则。
- [ ] `video` 商品额度为 0。
- [ ] `BILLING_USD_PER_*_CREDIT` 与真实模型账单和 Stars 收入匹配。
- [ ] `BILLING_MAX_REQUEST_USD` 能覆盖最昂贵模型一次最大输入/输出风险。
- [ ] 已用测试账号验证付款到账和幂等；未真实付款时标记 BLOCKED。

## 7. Agent 与 GitHub（启用时）

- [ ] Agent Worker 位于独立 VPS，不与 Bot 数据库/密钥共机。
- [ ] `AGENT_WORKER_URL` 使用 HTTPS 或受控私网。
- [ ] Bot/Worker 两侧 `AGENT_WORKER_SECRET` 相同且至少 32 位。
- [ ] `SANDBOX_ALLOW_SHELL=false`。
- [ ] GitHub App 只申请 Metadata read、Contents read/write、Pull requests read/write。
- [ ] OAuth callback 与 `PUBLIC_BASE_URL` 一致。
- [ ] 使用测试仓库验证连接、刷新、审批、写入、测试和 Draft PR。
- [ ] 未完成真实 Docker/GitHub/模型端到端时标记 BLOCKED。

## 8. 部署后 Telegram 实机

- [ ] `/ready` 正常，Runtime Logs 没有密钥或用户正文。
- [ ] 私聊一个问题只显示一条持续编辑的答案，完成后不消失。
- [ ] Telegram 原生加粗、斜体和引用输入不会报错。
- [ ] 回复引用失败时安全降级，不重复发送。
- [ ] 停止生成只停止当前用户对应请求。
- [ ] 群 `/help`、`/whoami` 和购买入口不会公开个人信息。
- [ ] A/B 两个用户的模型、流式任务、余额和统计互不影响。
- [ ] Telegram 10.3 检查按 [手机实机清单](TELEGRAM_10_3_MOBILE_TEST.md) 完成。

任何安全密钥、数据库兼容、支付或用户串线问题未解决时都应停止上线。
