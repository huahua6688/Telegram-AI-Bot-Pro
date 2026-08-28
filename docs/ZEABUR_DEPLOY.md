# Telegram-AI-Bot-Pro：Zeabur 操作步骤

本页只保留实际部署顺序。配置原因和全部变量见 [Zeabur 部署指南](ZEABUR.md) 与 [环境变量完整说明](ENVIRONMENT.md)。

## 1. 创建服务

1. Zeabur 新建 Project，选择 GitHub Repository。
2. 选择 `huahua6688/Telegram-AI-Bot-Pro` 和准备部署的分支。
3. 构建使用根目录 `Dockerfile`。
4. 添加 HTTP 端口 `8080`。

PR 分支测试完成前不要覆盖生产 `main`。

## 2. 创建数据卷

创建 Volume：

```text
挂载路径：/data
```

设置：

```env
DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json
```

## 3. 导入环境变量

从 `.env.zeabur.example` 复制，然后至少填写：

```env
NODE_ENV=production
BOT_TOKEN=
ADMIN_USER_IDS=

# 选择一个真实可用 Provider；以下只是 Gemini 示例
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

已有 `CHAT_ENCRYPTION_KEY` 时保留原值，只生成新的、不同的 `LOG_PRIVACY_KEY`。新随机值可在任意 VPS 执行：

```bash
openssl rand -base64 48
```

## 4. 选择 AI Hub 时替换 Provider 配置

```env
DEFAULT_AI_PROVIDER=openai-compatible
AI_API_KEY=
AI_BASE_URL=控制台提供的完整地址
AI_MODEL=控制台提供的模型ID
MODEL_DISCOVERY_ENABLED=true
```

不要同时把旧 `AI_PROVIDER` 设置成另一个平台。新部署让 `AI_PROVIDER` 留空。

## 5. 配置可选模块

### 客服 Bot

```env
SUPPORT_ENABLED=true
SUPPORT_BOT_TOKEN=
SUPPORT_BOT_USERNAME=
SUPPORT_ADMIN_IDS=
```

主/客服 Token 必须不同。客服 Bot 只允许私聊。

### Stars 与付费模型

复制 `.env.zeabur.example` 中完整的一行 `STARS_PRODUCTS_JSON`，并核对 `BILLING_*`。不要把昂贵模型加入免费模型规则。

### Agent

没有独立 VPS Worker 时保持：

```env
AGENT_ENABLED=false
```

## 6. 部署并检查

部署成功后依次确认：

```text
GET /ready
Runtime Logs
Telegram /whoami
Telegram 普通私聊
Telegram 控制台中的模型和额度
```

正常私聊流式回复应始终是同一条消息，不应出现第二条重复回复或完成后自动消失。

## 7. 常见 BackOff

| 日志 | 处理 |
| --- | --- |
| `MISSING_TELEGRAM_BOT_TOKEN` | 填写正确 `BOT_TOKEN` |
| `MISSING_AI_PROVIDER_CONFIG` | 填写所选 Provider 的 Key 和模型 |
| `Production requires CHAT_ENCRYPTION_REQUIRED=true` | 设置为 `true` |
| `CHAT_ENCRYPTION_KEY ...` | 新部署生成强密钥；已有部署恢复原密钥 |
| `Production requires ... LOG_PRIVACY_KEY` | 生成不同的日志隐私密钥 |
| `CHAT_ENCRYPTION_KEY_MISMATCH` | 立即恢复数据库原加密密钥 |
| `INVALID_PORT` | 使用 `PORT=8080`、`HEALTH_PORT=8080` |
| `DATABASE_PATH_NOT_FOUND` | 检查 `/data` Volume 与数据库路径 |
| `SUPPORT_BOT_TOKEN_CONFLICT` | 为客服 Bot 创建独立 Token |

更完整的错误说明见 [故障排查](TROUBLESHOOTING.md)。

## 8. 更新生产版本

1. 先备份 `/data/bot-data.db`，不要修改现有密钥。
2. 更新代码和新增普通变量，保留 Token、Key、Stars 套餐和数据库路径。
3. 重新部署后检查 `/ready`、日志和 Telegram 实机。
