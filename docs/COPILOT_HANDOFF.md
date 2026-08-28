# 开发交接说明

## 项目入口

开始修改前先阅读：

1. [项目完整说明](PROJECT_OVERVIEW.md)
2. [环境变量完整说明](ENVIRONMENT.md)
3. [安全说明](../SECURITY.md)
4. 与任务相关的部署、Stars、Agent 或 Telegram 实机文档

## 不可破坏的行为

- 用户模型、运行状态、流式请求、停止控制、统计、余额、订单和 Agent 任务必须按 Telegram 用户 ID 隔离。
- 群内单个用户事件不得向历史用户或群成员 fan-out 私聊。
- 客服 Bot 只处理 private chat；群组、超级群组和频道对所有内容完全静默。
- 群购买、余额、订单、`/help`、`/whoami` 的私密接口失败时跳主 Bot 私聊，不能公开回退。
- 私聊流式默认编辑同一条持久消息；不得同时发送临时草稿和第二条最终答案。
- Telegram entities、Rich Message、HTML 或引用失败必须安全降级，不能让回答重复或中断。
- `CHAT_ENCRYPTION_KEY` 不得自动生成、替换或回退；已有数据库必须使用原密钥。
- GitHub Token 使用独立 `GITHUB_TOKEN_ENCRYPTION_KEY`，不得复用聊天密钥。
- 付费/未知模型必须在 Provider 请求前通过购买余额和预算检查。
- Agent 命令不能在主 Bot 容器执行；Worker shell 默认关闭。
- 视频能力未实现，不能出售视频额度或写成已完成。

## 数据和配置

- SQLite schema 迁移必须向后兼容，部署前保留备份。
- 用户可修改的长期状态写入 SQLite，不只保存在内存。
- `.env.example`、`.env.zeabur.example` 和 `docs/ENVIRONMENT.md` 必须同步。
- 不要把新的模型 ID、价格或平台地址当成永久事实硬编码。
- `STARS_PRODUCTS_JSON` 是套餐唯一配置源。

## 修改后的必跑检查

```bash
npm test
npm run check:syntax
npm run check:secrets
git diff --check
```

有 Docker daemon 时再运行：

```bash
npm run docker:verify
```

不能把 Mock 测试写成真实 Telegram、Provider、GitHub、Stars 或 Docker 实机通过。需要外部条件的项目明确标记 BLOCKED。

## Git 与部署

- 功能分支提交并创建 Draft PR，不直接修改/合并 `main`，除非用户明确授权对应 PR。
- 不 force-push，不绕过分支保护，不提交真实密钥和数据库。
- 升级生产环境时保留 Zeabur Secret、Stars 商品、Volume 和聊天加密密钥。
