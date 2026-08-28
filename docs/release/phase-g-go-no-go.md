# Phase G Go/No-Go 发布清单

> 用于上线前唯一决策入口。所有 P0 必须清零，任一阻断项不通过即 No-Go。

## 1) 统一验收门槛

- [ ] **测试通过率**
  - [ ] PR 快速集（`npm run test:quick` + `npm run test:smoke`）100% 通过
  - [ ] 主干全量集（`npm run test:full`）100% 通过
  - [ ] 发布候选集（`npm run test:release`）100% 通过
- [ ] **性能阈值**
  - [ ] 负载基线测试在阈值内（默认 `PHASE_G_LOAD_THRESHOLD_MS=15000`）
- [ ] **故障恢复目标**
  - [ ] 注入依赖故障后接口可恢复
  - [ ] 进程重启后 SQLite 会话数据保持可读
- [ ] **安全零高危**
  - [ ] CodeQL 无高危阻断项
  - [ ] 管理 API 鉴权与 RBAC 校验通过
  - [ ] Secrets 扫描无泄漏
  - [ ] 生产聊天加密、日志隐私和 GitHub Token 使用不同强密钥
  - [ ] Agent Worker 独立部署、shell 关闭且没有生产密钥注入沙箱
- [ ] **文档完整度**
  - [ ] 部署主流程、平台差异、回滚、备份、故障排查齐备
  - [ ] 最小可用/生产推荐两档模板与环境变量规范一致
  - [ ] `.env.example`、`.env.zeabur.example` 与 `docs/ENVIRONMENT.md` 一致
- [ ] **Telegram 实机**
  - [ ] 单消息流式、停止生成、格式/引用回退通过
  - [ ] 群购买、`/help`、`/whoami` 不泄露且无 fan-out
  - [ ] 客服 Bot 群/频道完全静默，私聊工单类型通过
  - [ ] 未完成的手机实测明确标记 BLOCKED

## 2) 发布决策

- [ ] Go
- [ ] No-Go
- [ ] 决策人：
- [ ] 决策时间：
- [ ] 备注：
