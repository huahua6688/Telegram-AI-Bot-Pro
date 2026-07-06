# Telegram-AI-Bot-Pro Zeabur 部署说明

## 部署方式

Zeabur 选择 GitHub 部署：

- 仓库：huahua6688/Telegram-AI-Bot-Pro
- 构建方式：Dockerfile
- 端口类型：HTTP
- 端口：8080

## Volume

如果使用 SQLite，建议创建 Volume：

- 卷名称：telegram-bot-data
- 挂载路径：/data

对应环境变量：

DATABASE_FILE=/data/bot-data.db
DATA_FILE=/data/bot-data.json

## 必填环境变量

BOT_TOKEN=
AI_PROVIDER=gemini
AI_MODEL=gemini-2.0-flash
GEMINI_API_KEY=
DATABASE_FILE=/data/bot-data.db
PORT=8080
HEALTH_PORT=8080

## Gemini Live 可选环境变量

GEMINI_LIVE_API_KEY=
GEMINI_LIVE_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_LIVE_TRANSCRIPTION_MODEL=
GEMINI_LIVE_TTS_MODEL=
ENABLE_LIVE_AUDIO=true
ENABLE_LIVE_TRANSLATE=true

## 常见错误

### BackOff / 容器反复重启

先看 Runtime Logs，重点检查：

- BOT_TOKEN 是否填写
- AI_PROVIDER 是否正确
- API Key 是否填写
- PORT / HEALTH_PORT 是否为 8080
- DATABASE_FILE 是否指向 /data

### pdf-parse 报错

ESM 项目里不要使用错误的 default import。当前使用：

import * as pdfParse from 'pdf-parse';

const { PDFParse } = pdfParse;

### 端口错误

Zeabur 会注入 PORT，代码必须读取 process.env.PORT，不要写死 3000。
