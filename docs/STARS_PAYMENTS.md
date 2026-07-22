# Telegram Stars 支付与用量计费

机器人内的数字服务统一使用 Telegram Stars。发票币种固定为 `XTR`，不需要第三方支付商 Token。

## 1. 配置商品包

在 Zeabur 或服务器环境变量中设置 `STARS_PRODUCTS_JSON`。它必须是一行 JSON 数组，价格和额度都由环境变量决定，代码内没有付费价格默认值。

```env
STARS_PAYMENTS_ENABLED=true
STARS_PRODUCTS_JSON=[{"id":"starter","title":"入门额度包","titleEn":"Starter credits","description":"聊天、图片和语音综合额度","descriptionEn":"Credits for chat, images and voice","price":50,"credits":{"chat":200,"vision":20,"image_generation":5,"tts":20,"live_voice":10,"video":0}}]
```

字段说明：

- `id`：商品唯一 ID，只能使用小写字母、数字、`_` 和 `-`。
- `title` / `titleEn`：中英文发票标题，最多 32 个字符。
- `description` / `descriptionEn`：中英文发票说明，最多 255 个字符。
- `price`：整数 Telegram Stars 数量。
- `credits`：六类独立额度：`chat`、`vision`、`image_generation`、`tts`、`live_voice`、`video`。

修改商品价格不会影响已经创建的订单；每张订单会保存当时的价格和赠送额度快照。

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

## 3. 用户入口

用户通过主菜单或输入框下方的“购买额度”“我的余额”按钮使用支付功能，不需要记 Slash 指令。付款流程为：

1. 选择额度包并创建 Stars 发票。
2. Telegram 发出预结账查询，机器人校验订单用户、`XTR`、金额、状态和过期时间。
3. 只有收到 `successful_payment` 后才增加额度。
4. `telegram_payment_charge_id` 会持久化并建立唯一约束；Telegram 重复发送回调也不会重复增加额度。

`/terms` 和 `/paysupport` 是支付合规辅助入口，不会加入主要命令菜单。

## 4. 退款

管理员可以使用：

```text
/refundstars telegram_payment_charge_id
```

机器人会调用 Telegram `refundStarPayment`。退款前会冻结该订单赠送的额度；如果额度已经消费到不足以完整撤回，退款会被拒绝。Telegram API 调用失败时会自动恢复冻结额度，成功后订单与退款记录写入 SQLite。

如果服务在 Telegram 已退款、SQLite 尚未确认之间重启，退款记录会保留为 `pending`，额度不会被错误恢复。管理员重新执行同一个 `/refundstars telegram_payment_charge_id` 即可幂等完成对账，不会重复退款。

## 5. 数据与排错

订单、六类余额、每日免费用量、消费记录和退款记录都保存在 `DATABASE_FILE` 指向的 SQLite 数据库。部署时必须为数据库目录挂载持久化存储。

Mini App 的管理员用户列表中可以按账号查看并保存六类“已购额度余额”。这个操作只修改已购余额，不会改变该用户的每日免费额度；每次修改都会把管理员、修改前余额、修改后余额和差值写入审计记录。管理员 API 同时提供：

- `GET /api/miniapp/admin/users/:id/credits`
- `PATCH /api/miniapp/admin/users/:id/credits`

`PATCH` 支持完整覆盖六类余额的 `set`，以及安全增减的 `adjust`；余额不会允许变成负数。

如果用户 Stars 已扣除但额度未到账，让用户打开“支付支持”，并使用其 Telegram ID、付款时间和日志中的 charge ID 核对。不要要求用户提供密码、验证码或 API Key。
