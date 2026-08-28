# Telegram Stars 支付与用量计费

机器人内的数字服务统一使用 Telegram Stars。发票币种固定为 `XTR`，不需要第三方支付商 Token。

`STARS_PRODUCTS_JSON` 只决定用户买多少 Stars、获得多少内部额度；`BILLING_*` 决定付费模型一次实际扣多少内部额度。两者必须一起按照真实 Provider 账单核算。模板中的套餐是保守起步示例，不保证在所有 Telegram 结算汇率、退款率或昂贵模型价格下持续盈利。

## 1. 配置商品包

在 Zeabur 或服务器环境变量中设置 `STARS_PRODUCTS_JSON`。它必须是一行 JSON 数组，价格和额度都由环境变量决定，代码内没有付费价格默认值。

```env
STARS_PAYMENTS_ENABLED=true
STARS_PRODUCTS_JSON=[{"id":"starter","title":"入门额度包","titleEn":"Starter credits","description":"包含约2次高成本AI Hub请求及免费平台扩展额度","descriptionEn":"Includes about 2 high-cost AI Hub requests plus free-provider credits","price":300,"credits":{"chat":30,"vision":20,"image_generation":5,"tts":20,"live_voice":10,"video":0}},{"id":"standard","title":"标准额度包","titleEn":"Standard credits","description":"包含约6次高成本AI Hub请求及日常功能额度","descriptionEn":"Includes about 6 high-cost AI Hub requests plus regular feature credits","price":800,"credits":{"chat":90,"vision":80,"image_generation":20,"tts":80,"live_voice":40,"video":0}},{"id":"pro","title":"高级额度包","titleEn":"Pro credits","description":"包含约16次高成本AI Hub请求及高频功能额度","descriptionEn":"Includes about 16 high-cost AI Hub requests plus high-volume feature credits","price":2000,"credits":{"chat":240,"vision":300,"image_generation":75,"tts":300,"live_voice":150,"video":0}}]
```

字段说明：

- `id`：商品唯一 ID，只能使用小写字母、数字、`_` 和 `-`。
- `title` / `titleEn`：中英文发票标题，最多 32 个字符。
- `description` / `descriptionEn`：中英文发票说明，最多 255 个字符。
- `price`：整数 Telegram Stars 数量。
- `credits`：六类独立额度：`chat`、`vision`、`image_generation`、`tts`、`live_voice`、`video`。

当前 `live_voice` 实际用于语音转写；视频模型链尚未实现，程序会强制把商品中的 `video` 额度归零，即使 JSON 误填了大于 0 的数字也不会出售。

修改商品价格不会影响已经创建的订单；每张订单会保存当时的价格和赠送额度快照。

这份 JSON 是商品标题、价格和额度的唯一配置源。主 Bot 商店、Mini App 用户页和管理员页面都会读取相同目录；修改后重新部署即可同步显示，无需再改页面常量。

## 2. 配置每日免费额度

```env
STARS_FREE_CHAT_DAILY=20
STARS_FREE_VISION_DAILY=3
STARS_FREE_IMAGE_DAILY=1
STARS_FREE_TTS_DAILY=2
STARS_FREE_LIVE_VOICE_DAILY=2
STARS_FREE_VIDEO_DAILY=0
STARS_USAGE_RESERVATION_TTL_MINUTES=15
STARS_REFUND_LEASE_SECONDS=300
ENABLE_VIDEO=false
```

每次请求会先以 `reserved` 状态预留额度，结果成功交付后才记为已消费；失败会立即归还。进程异常留下的预留会在超时后自动归还，超时时间由 `STARS_USAGE_RESERVATION_TTL_MINUTES` 控制。

普通用户先消费当天免费额度，免费额度用完后才扣已购余额。管理员请求会记录为管理员用量，但不会扣免费额度或已购余额。视频拥有独立余额，功能默认关闭；关闭时发送视频不会扣额度。

上述“先用免费额度”只适用于被明确判定为免费的 Provider/模型。`PAID_PROVIDER_PATTERNS`、付费模型规则、模型目录明确价格或未知价格的模型不会使用每日免费额度，必须有购买余额。

## 3. 配置付费模型换算

```env
BILLING_USD_PER_CHAT_CREDIT=0.10
BILLING_USD_PER_VISION_CREDIT=
BILLING_USD_PER_IMAGE_CREDIT=
BILLING_USD_PER_TTS_CREDIT=
BILLING_USD_PER_LIVE_VOICE_CREDIT=
BILLING_USD_PER_VIDEO_CREDIT=
BILLING_COST_MARKUP=1.50
BILLING_MAX_REQUEST_USD=2
AI_MAX_OUTPUT_TOKENS=2048
PAID_PROVIDER_PATTERNS=openai-compatible
FREE_MODEL_PATTERNS=:free,gemini-2.5-flash-lite
PAID_MODEL_PATTERNS=claude-opus,claude-sonnet,gpt-5
```

- `BILLING_USD_PER_*_CREDIT`：一个内部额度代表多少美元模型成本。某能力留空/为 0 时，该能力的付费或未知价格模型安全关闭。
- `BILLING_COST_MARKUP`：成本加成倍数，不能小于 1。
- `BILLING_MAX_REQUEST_USD`：请求前预冻结的最大美元预算，不是上游网络层的硬停损。
- `AI_MAX_OUTPUT_TOKENS`：兼容 Provider 的单次输出上限。

Zeabur AI Hub/LiteLLM 的 `x-litellm-response-cost`、OpenRouter 的 `usage.cost` 和兼容费用字段会统一记录。费用已知时按实际成本乘加成结算并退回剩余额度；某次 fallback 之前的失败请求如果已经产生费用，也会累计。费用字段不可靠时按冻结上限扣费。

单个 Provider 请求发出后，Bot 无法保证在上游费用刚达到阈值时立刻切断。因此上线前要按最昂贵模型的最大输入、最大输出、重试和 fallback 评估风险。

## 4. 用户入口

用户通过主菜单或输入框下方的“购买额度”“我的余额”按钮使用支付功能，不需要记 Slash 指令。付款流程为：

1. 选择额度包并创建 Stars 发票。
2. Telegram 发出预结账查询，机器人校验订单用户、`XTR`、金额、状态和过期时间。
3. 只有收到 `successful_payment` 后才增加额度。
4. `telegram_payment_charge_id` 会持久化并建立唯一约束；Telegram 重复发送回调也不会重复增加额度。

`/terms` 和 `/paysupport` 是支付合规辅助入口，不会加入主要命令菜单。

在群组中点击“购买额度”时，Bot 优先使用 Telegram 只对点击用户可见的临时/私密界面。接口不可用时直接打开主 Bot 私聊购买页。群时间线不得公开套餐、余额、订单或付款信息。

## 5. 退款

管理员可以使用：

```text
/refundstars telegram_payment_charge_id
```

机器人会调用 Telegram `refundStarPayment`。退款前会冻结该订单赠送的额度；如果额度已经消费到不足以完整撤回，退款会被拒绝。Telegram API 调用失败时会自动恢复冻结额度，成功后订单与退款记录写入 SQLite。

如果服务在 Telegram 已退款、SQLite 尚未确认之间重启，退款记录会保留为 `pending`，额度不会被错误恢复。管理员重新执行同一个 `/refundstars telegram_payment_charge_id` 即可幂等完成对账，不会重复退款。

## 6. 数据与排错

订单、六类余额、每日免费用量、消费记录和退款记录都保存在 `DATABASE_FILE` 指向的 SQLite 数据库。部署时必须为数据库目录挂载持久化存储。

Mini App 的管理员用户列表中可以按账号查看并保存六类“已购额度余额”。这个操作只修改已购余额，不会改变该用户的每日免费额度；每次修改都会把管理员、修改前余额、修改后余额和差值写入审计记录。管理员 API 同时提供：

- `GET /api/miniapp/admin/users/:id/credits`
- `PATCH /api/miniapp/admin/users/:id/credits`

`PATCH` 支持完整覆盖六类余额的 `set`，以及安全增减的 `adjust`；余额不会允许变成负数。

如果用户 Stars 已扣除但额度未到账，让用户打开“支付支持”，并使用其 Telegram ID、付款时间和日志中的 charge ID 核对。不要要求用户提供密码、验证码或 API Key。

真实上线前至少用测试账号验证一次：创建发票、预结账、成功付款、重复回调、余额到账、使用结算和退款。自动化 Mock 通过不能称为真实 Telegram Stars 付款通过。
