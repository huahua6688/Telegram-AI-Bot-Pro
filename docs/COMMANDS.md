# 常用命令说明

## 启动

    npm start

## 配置检查

    npm run doctor

## 快速验证

    npm run verify

会运行：

    npm run check:secrets
    npm run check:syntax
    npm run test:quick

## Docker 验证

    npm run docker:verify

会构建 Docker 镜像，并在镜像内运行 doctor。

## 部署前检查

    npm run predeploy

部署 Zeabur 前推荐运行。

## GitHub 与 Agent（Telegram）

```text
/github connect
/github status
/github repos
/github disconnect
/agent owner/repository 任务说明
/agent status
/welcome set 欢迎 {name} 加入 {chat}
/welcome status
/welcome off
```

Agent 创建分支、写文件和创建 Pull Request 时会显示批准/拒绝按钮。`/welcome` 只允许 Bot 管理员或当前群管理员设置，并要求 Bot 具有 Telegram 的“发送欢迎消息”管理员权限。完整部署配置见 [付费模型、Agent 与 GitHub](PAID_AGENT_GITHUB.md)。
