# 项目文档索引

这里集中放 Telegram AI Bot Pro 的部署、配置和排错文档。

## Zeabur 部署

    docs/ZEABUR.md

用于查看 Zeabur 部署步骤、端口、磁盘挂载、健康检查和常见部署问题。

## 部署前检查清单

    docs/DEPLOY_CHECKLIST.md

部署前按这个清单检查，避免漏填环境变量、忘记挂载磁盘、管理员 ID 配错。

## 环境变量说明

    docs/ENVIRONMENT.md

解释每个环境变量的作用，例如 BOT_TOKEN、GEMINI_API_KEY、AI_MODEL、ADMIN_USER_IDS。

## 故障排查

    docs/TROUBLESHOOTING.md

用于排查 Zeabur BackOff、Gemini 429、健康检查失败、数据库丢失、管理员权限问题。

## 推荐阅读顺序

第一次部署：

    1. docs/ZEABUR.md
    2. docs/ENVIRONMENT.md
    3. docs/DEPLOY_CHECKLIST.md

出错时：

    1. docs/TROUBLESHOOTING.md
    2. docs/DEPLOY_CHECKLIST.md

## 常用命令说明

    docs/COMMANDS.md

解释 npm start、npm run verify、npm run doctor、npm run predeploy、npm run docker:verify 等命令。
