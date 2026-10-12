#!/usr/bin/env bash
# Update the bot on the server: pull the latest code, rebuild, and swap the container.
# Usage (on the server): ~/discord-bot/deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "== 下載新的程式碼"
git pull --ff-only

echo "== 重新 build 映像檔"
docker build -t discord-bot .

echo "== 換成新的容器"
docker rm -f discord-bot >/dev/null 2>&1 || true
docker run -d --name discord-bot --restart unless-stopped \
  -v "$PWD/data:/app/data" --env-file .env discord-bot >/dev/null

sleep 5
echo "== 最新 log"
docker logs --tail 20 discord-bot
