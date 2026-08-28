# 命令与操作说明

Telegram 命令菜单默认只展示最常用的 `/start`、`/help`、`/whoami`；其他命令仍可手动输入。大部分用户功能也可以通过底部按钮或 Mini App 控制台完成。

## 1. 普通用户命令

| 命令 | 作用 | 备注 |
| --- | --- | --- |
| `/start` | 打开主入口 | 可接收购买、欢迎等 deep-link 参数 |
| `/help` | 简明帮助和功能入口 | 群内优先私密显示；失败时引导私聊 |
| `/whoami` | 查看 Telegram ID 与管理员状态 | 私聊不重复显示 Chat ID；群内额外显示群组 ID，并保持私密 |
| `/menu` | 打开主菜单 | Mini App 开启时优先使用控制台 |
| `/models` | 查看/选择模型 | 每个用户独立保存，不会修改其他用户 |
| `/memory` | 记忆设置 | 可通过按钮管理 |
| `/clear` / `/reset` | 清理会话提示 | 会要求用户选择具体清理范围 |
| `/topic` / `/topics` | 查看当前主题/主题列表 | 与用户自己的会话状态绑定 |
| `/web 关键词` | 联网搜索 | 受工具权限、限流和搜索配置控制 |
| `/translate 文本` / `/tr 文本` | 自动翻译 | 使用翻译专用 Provider/模型 |
| `/persona` | 选择助手人格 | 用户级设置 |
| `/language` | 选择界面/回答语言 | 用户级设置 |
| `/terms` | 查看 Stars 服务条款 | 支付合规辅助命令 |
| `/paysupport` | 打开支付支持 | 不要求用户提供密码、验证码或 API Key |

## 2. GitHub 与 Agent

```text
/github status
/github connect
/github repos
/github disconnect
/agent status
/agent owner/repository 任务说明
```

- `/github connect`：先选择 GitHub App 可访问仓库，再连接 GitHub 身份。
- `/github repos`：最多显示当前授权可访问仓库。
- `/github disconnect`：删除本地加密授权连接，不会自动卸载 GitHub App。
- `/agent status`：列出当前用户最近任务。
- `/agent owner/repository 任务说明`：创建付费持久 Agent 任务。

Agent 创建分支、写文件和创建 Pull Request 时显示批准/拒绝按钮。任务状态、审批、暂停、继续、取消和报告全部按发起用户隔离。

如果 `AGENT_ENABLED=false`、Worker、计费或 GitHub App 未配置完整，命令会明确提示未配置，不会在 Bot 容器里直接执行命令。

## 3. 群组管理命令

| 命令 | 权限 | 作用 |
| --- | --- | --- |
| `/chatmode` | Bot 管理员/群管理员 | 切换群聊响应模式 |
| `/keyword` | Bot 管理员/群管理员 | 配置关键词触发 |
| `/welcome status` | Bot 管理员/群管理员 | 查看欢迎语与 Bot 权限 |
| `/welcome set 欢迎 {name} 加入 {chat}` | Bot 管理员/群管理员 | 保存群欢迎语 |
| `/welcome off` | Bot 管理员/群管理员 | 关闭欢迎语 |
| `/allow 用户ID` | 管理员 | 加入 Guard 动态白名单 |
| `/disallow 用户ID` | 管理员 | 移出动态白名单 |
| `/block 用户ID` | 管理员 | 加入动态黑名单 |
| `/unblock 用户ID` | 管理员 | 移出动态黑名单 |

欢迎语变量：

- `{name}`：新成员显示名
- `{username}`：有用户名时显示 `@username`，否则使用显示名
- `{chat}`：群名称

Bot 必须是群管理员并具有 Telegram 的“发送欢迎消息”权限。欢迎购买入口只对新成员私密显示；私密接口失败时跳主 Bot 私聊，不公开套餐和余额。

## 4. 管理员命令

| 命令 | 作用 |
| --- | --- |
| `/status` | 查看 Bot、Provider、数据库和运行状态 |
| `/refundstars telegram_payment_charge_id` | 对指定 Telegram Stars 付款执行幂等退款 |

管理员模型菜单中的“我的模型”只修改管理员本人；“全局默认模型”只影响仍使用自动模式的用户，不覆盖其他用户已经手动选择的模型。

## 5. 客服 Bot

客服 Bot 不提供群组命令。群组、超级群组和频道中的普通消息、媒体、提及和 `/support` 全部静默忽略。

用户需要通过主 Bot 的“联系客服”按钮或客服 Bot 链接进入私聊。客服人员在自己的私聊中通过工单按钮接单，并回复带工单标记的复制消息来回应正确用户。

## 6. 项目运维命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 启动 Bot |
| `npm run dev` | Node watch 开发模式 |
| `npm run doctor` | 检查部署配置、Provider、路径和端口 |
| `npm run check:secrets` | 检查意外提交的密钥、环境文件和数据库 |
| `npm run check:syntax` | 检查 JavaScript 语法 |
| `npm test` | 运行全部 Node 测试 |
| `npm run test:quick` | 快速回归测试 |
| `npm run test:feature` | 启动、客服、计费等功能测试 |
| `npm run test:full` | 快速、功能、E2E 和回归测试 |
| `npm run test:release` | 完整测试加负载和故障注入 |
| `npm run verify` | secrets、语法、quick、feature |
| `npm run docker:verify` | 构建镜像并在 Docker 中运行诊断 |
| `npm run predeploy` | doctor、verify 和 Docker 验证 |

`npm run docker:verify` 和 `npm run predeploy` 需要可用的 Docker daemon。没有 Docker 的环境只能把该项标记为 BLOCKED，不能称为真实容器验证通过。
