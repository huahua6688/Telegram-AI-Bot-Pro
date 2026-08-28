# 安全说明

## 1. 密钥应该放在哪里

生产密钥通过 Zeabur Secret Variables、VPS `.env` 权限文件或同等秘密管理系统注入。使用环境变量本身不是漏洞；把密钥提交到 Git、写入日志、截图分享或让不可信进程读取才是泄露风险。

禁止提交：

```text
.env
.env.*（示例模板除外）
data/
*.db
*.sqlite
*.sqlite3
```

允许提交的空模板：

```text
.env.example
.env.zeabur.example
```

提交前运行：

```bash
npm run check:secrets
```

## 2. 生产环境必须配置

```env
NODE_ENV=production
CHAT_ENCRYPTION_REQUIRED=true
CHAT_ENCRYPTION_KEY=
LOG_PRIVACY_KEY=
ADMIN_API_ENABLED=false
ENABLE_NATIVE_DRAFT_STREAMING=false
```

分别运行下面命令生成新密钥：

```bash
openssl rand -base64 48
```

规则：

- 已经使用的 `CHAT_ENCRYPTION_KEY` 必须保留，不能重新生成。
- `LOG_PRIVACY_KEY` 必须与聊天密钥不同，并长期固定。
- 启用 GitHub App 时，`GITHUB_TOKEN_ENCRYPTION_KEY` 必须是第三个不同密钥。
- 启用 Agent 时，`AGENT_WORKER_SECRET` 必须至少 32 位，并只在 Bot 与 Worker 两侧保存。
- 启用 Admin API 时，`ADMIN_API_TOKEN` 必须至少 32 位、随机且不使用示例值。

## 3. 数据保护

- 私聊内容、主题摘要和长期记忆使用 AES-GCM 加密后写入 SQLite。
- 旧明文记录会在设置聊天密钥后的数据库迁移中加密。
- 数据库会保存密钥校验信息；错误密钥会触发 `CHAT_ENCRYPTION_KEY_MISMATCH`，避免用新密钥继续破坏数据。
- GitHub 用户访问/刷新 Token 使用独立密钥加密，不能回退到聊天密钥。
- Mini App 和管理员会话详情默认不返回用户原文；只有显式设置 `MINI_APP_SHOW_USER_MESSAGES=true` 才开放。
- 对话默认按 `CONVERSATION_RETENTION_DAYS=30` 清理；Stars、余额、订单和审计不会被对话清理误删。
- 临时隐私聊天只保存在进程内存，不写普通历史或长期记忆。

生产升级前先备份 `/data/bot-data.db`。备份数据库和聊天加密密钥必须分开保存。

## 4. 长期记忆和日志

长期记忆在调用总结模型前执行独立敏感信息检测。疑似密码、验证码、API Key、Token、私钥或助记词的内容不会发给记忆总结模型，也不会写入长期记忆；已有不安全记忆会在读取/清理路径中删除。

结构化日志默认移除：

- 用户消息、提示词和模型正文
- 用户名、IP、User-Agent
- 原始异常正文和堆栈
- 常见 API Key、Bearer Token、Bot Token、Cookie、私钥和凭据格式

日志通过 `LOG_PRIVACY_KEY` 生成稳定匿名 ID，既不直接暴露 Telegram 用户 ID，也能跨重启进行审计。

## 5. Admin API 与访问控制

普通部署保持：

```env
ADMIN_API_ENABLED=false
```

确实需要外部管理后台时：

- 使用强 `ADMIN_API_TOKEN`。
- 在反向代理、防火墙或私网层限制来源。
- 不把 3001 端口直接暴露到公网。
- 定期审查管理员 ID 和审计记录。
- 不把“Token 足够长”当成完整的网络隔离。

`ALLOWED_USER_IDS` 非空时会限制主 Bot 用户范围；`BLOCKED_USER_IDS` 优先拒绝。Guard 动态名单保存在 SQLite。

## 6. 客服、群组和付款隐私

- 客服 Bot 使用独立 BotFather Token，不能复用主 Bot Token。
- 客服 Bot 只处理 private chat；群组、超级群组和频道完全静默。
- 系统、付款、invoice、paid media、giveaway 和 Bot 消息不会进入客服工单。
- 群欢迎、购买、余额、订单、`/help` 和 `/whoami` 优先使用私密 Telegram 能力。
- 私密接口失败时直接跳主 Bot 私聊，不在群里公开个人信息。
- Stars 只有收到 Telegram `successful_payment` 后才增加额度；charge ID 有唯一约束，重复回调不会重复到账。

## 7. 搜索、文件和外部内容

- `fetch_url` 拒绝本机、内网、链路本地、云元数据、保留地址、非 80/443 端口和不安全重定向。
- 外部响应有大小限制；Telegram 文件下载有声明大小、流式大小和超时双重检查。
- 联网工具有用户/聊天白名单、黑名单、每消息调用数、用户窗口和进程并发限制。
- 外部网页、文档、GitHub 内容和模型输出都属于不可信输入，不能绕过工具权限或审批。

## 8. Agent Worker

Agent Worker 必须与主 Bot 分开部署。默认安全边界包括：

- HMAC 请求签名和五分钟时间窗口
- 镜像、命令和路径白名单
- shell 默认关闭
- 一次性 Docker 容器
- 普通命令无网络
- 只读根文件系统
- 删除全部 Linux capabilities
- `no-new-privileges`
- CPU、内存、PID、文件描述符、超时和工作区大小限制
- Bot Token、模型 Key 和生产数据库不进入命令参数或沙箱

Worker 挂载 Docker socket，等同于拥有 Worker 主机高权限。即使容器参数严格，Docker daemon 或宿主机漏洞仍可能突破隔离。因此 Worker VPS 必须专用、及时更新，不得存放主 Bot 数据和生产密钥。

## 9. 密钥泄露后的处理

| 泄露内容 | 立即操作 |
| --- | --- |
| `BOT_TOKEN` / `SUPPORT_BOT_TOKEN` | 在 BotFather revoke，生成新 Token，更新部署变量并重启 |
| Provider API Key | 在对应平台撤销旧 Key，创建新 Key，检查用量账单 |
| `ADMIN_API_TOKEN` | 立即更换，检查管理审计并限制端口来源 |
| `AGENT_WORKER_SECRET` | 同时更换 Bot 和 Worker 两侧密钥，检查 Worker 请求日志 |
| GitHub App Client Secret | 在 GitHub App 后台轮换，更新部署变量，审查授权和仓库操作 |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | 先隔离数据库与服务；不能直接替换后期待旧 Token 自动可读，需要重新授权或专门迁移 |
| `CHAT_ENCRYPTION_KEY` | 视为数据库内容可能泄露；先隔离数据库并保留旧密钥用于受控迁移，不能直接删除或覆盖 |
| `LOG_PRIVACY_KEY` | 更换后旧日志匿名 ID 无法连续关联；检查日志访问范围 |

不要把泄露的完整值发到 Issue、PR、聊天或客服工单中。

## 10. 安全报告怎么判断

自动扫描报告是线索，不是最终结论：

- “代码从环境变量读取 Key”本身通常是正常设计；需要确认平台是否安全注入、日志是否脱敏、仓库是否误提交。
- “存在沙箱”不等于已经证明可抵抗所有逃逸；要同时检查 Docker 参数、宿主机、命令白名单、网络和真实渗透测试。
- “提示模型不要保存秘密”不够；本项目另有代码级敏感信息检测。
- Mock 测试只能证明代码路径，不代表真实 Telegram、Provider、GitHub 或 Docker 生产环境通过。

发现问题时应提供可复现路径、受影响版本、输入条件和实际影响。不要在公开报告中附带真实密钥或用户数据。

## 11. 当前仍需外部验证

- Telegram Bot API 10.3 在真实 iOS/Android 客户端的私密消息与回退行为。
- 独立 VPS 上的真实 Docker Worker 端到端和安全审计。
- 真实 GitHub App OAuth、Token 刷新和测试仓库 PR。
- 真实付费 Provider 成本字段、Stars 付款与退款对账。

这些项目在完成真实环境验证前必须标记为 BLOCKED，不能用模拟测试代替。
