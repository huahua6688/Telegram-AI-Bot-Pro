#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-telegram-ai-bot-pro:test}"

docker run --rm \
  -e BOT_TOKEN=dummy_bot_token \
  -e AI_PROVIDER=gemini \
  -e GEMINI_API_KEY=dummy_gemini_key \
  -e AI_MODEL=gemini-2.5-flash \
  -e AI_FALLBACK_MODELS=gemini-2.0-flash,gemini-2.5-flash-lite \
  -e TRANSLATION_MODEL=gemini-2.5-flash-lite \
  -e ROUTER_MODEL=gemini-2.5-flash-lite \
  -e ADMIN_USER_IDS=123456789 \
  "$IMAGE_NAME" npm run doctor
