# 故障排查

## Zeabur BackOff

先看日志有没有：

    Invalid runtime configuration

常见原因：

    BOT_TOKEN 没填
    GEMINI_API_KEY 没填
    DEFAULT_AI_MODEL 配置错误或对应 Provider 没有可用模型
    ADMIN_API_ENABLED=true 但 ADMIN_API_TOKEN 没填

新启动诊断会在 BackOff 前打印稳定错误码：

- `MISSING_TELEGRAM_BOT_TOKEN`：主 Bot Token 缺失或仍是示例值。
- `MISSING_AI_PROVIDER_CONFIG`：默认 Provider 未配置完整，或自动模式下没有任何可用聊天 Provider。
- `INVALID_PORT`：`PORT` / `HEALTH_PORT` 不是 1–65535 的整数。
- `DATABASE_PATH_NOT_FOUND`：数据库父目录不存在或无法准备。
- `GEMINI_LIVE_CONFIG_MISSING`：已开启 Live 功能但缺少独立 Gemini Live Key 或兼容模型。
- `SUPPORT_BOT_TOKEN_CONFLICT`：客服 Bot 错误地复用了主 Bot Token。
- `MISSING_SUPPORT_ADMIN_IDS`：启动了客服 Bot，但没有配置可处理工单的管理员 ID。

日志只会显示掩码后的 Token / Key，不要为了排错把完整密钥复制到公开日志或工单中。

## Gemini 429

这是当前 Gemini API Key 的额度或频率限制。同一 Key 收到 `RESOURCE_EXHAUSTED` 后，继续切换 Gemini 模型通常也无法恢复；程序会立即跳过该 Provider 的其余模型。

要实现真正的自动切换，请至少配置另一个 Provider 的 Key，并保持自动模式：

    DEFAULT_AI_PROVIDER=auto
    ENABLE_PROVIDER_FALLBACK=true
    AI_PROVIDER_FALLBACK_ORDER=gemini,groq,openrouter
    GROQ_API_KEY=
    OPENROUTER_API_KEY=
    OPENROUTER_MODEL=openrouter/free

每个备用平台都必须有自己的独立 Key；只配置 Gemini Key 不是真正的跨平台回退。`AI_PROVIDER_MAX_RETRIES` 表示首次失败后的额外重试数，例如 `1` 表示每个模型最多尝试两次。

Zeabur 的环境变量和 `/data/bot-data.db` 会跨部署保留。重新部署代码不会自动替换旧的模型选择；请同时检查服务环境变量，并在控制台把受影响用户的 Provider 设为 `auto`。

Inline Mode 默认有 8 秒总响应预算、2.3 秒搜索预算和 2.2 秒单模型预算。即使 AI 额度耗尽，只要联网搜索已经取得结果，也会直接返回整理后的搜索来源，不再等待失效的 Telegram Query ID。

若需要稳定的实时搜索，请配置 `BRAVE_SEARCH_API_KEY`。未配置时使用的免密搜索只提供尽力而为的回退，可能受服务器网络或上游页面变化影响。

## /status 没权限

/status 是管理员命令。

先发：

    /whoami

然后把 User ID 填到：

    ADMIN_USER_IDS

## 数据丢失

确认 Zeabur 挂载了：

    /data

并设置：

    DATABASE_FILE=/data/bot-data.db
    DATA_FILE=/data/bot-data.json

## npm run verify 失败

看失败位置：

    check:secrets  误提交密钥或数据库
    check:syntax   JS 语法错误
    test:quick     测试失败
