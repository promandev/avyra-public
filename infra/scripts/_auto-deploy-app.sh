#!/bin/bash
# Auto-deploy: pulls latest image and recreates the app container if updated.
# Installed at /home/youruser/auto-deploy-app.sh
# Runs via cron every 5 minutes. Replaces Watchtower for the app service.
#
# Setup (one-time):
#   crontab -e
#   */5 * * * * /home/youruser/auto-deploy-app.sh
#

COMPOSE_DIR="/home/youruser/avyra/infra"
SERVICE="app"
IMAGE="ghcr.io/youruser/avyra-app:latest"
LOCK="/tmp/auto-deploy-app.lock"
LOG="/home/youruser/auto-deploy-app.log"  # writable by youruser user

# Prevent concurrent runs — also detect stale locks (older than 15 min)
if [ -f "$LOCK" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK") ))
  if [ "$LOCK_AGE" -lt 900 ]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) SKIP: lock held for ${LOCK_AGE}s" >> "$LOG"
    exit 0
  fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) WARN: stale lock (${LOCK_AGE}s), removing" >> "$LOG"
  rm -f "$LOCK"
fi

# Remove lock on any exit, including SIGTERM/SIGHUP
trap 'rm -f $LOCK' EXIT TERM HUP
touch "$LOCK"

# Current image SHA running in the container
CURRENT=$(docker inspect pradomotica-app-1 --format '{{.Image}}' 2>/dev/null || echo "none")

# Pull latest image (with timeout to prevent hanging)
if ! timeout 300 docker pull "$IMAGE" > /dev/null 2>&1; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR: docker pull failed or timed out" >> "$LOG"
  exit 1
fi

# SHA of the newly pulled image
LATEST=$(docker inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || echo "")

if [ -z "$LATEST" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR: could not inspect pulled image" >> "$LOG"
  exit 1
fi

if [ "$CURRENT" != "$LATEST" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) DEPLOY: ${CURRENT:7:12} -> ${LATEST:7:12}" >> "$LOG"
  cd "$COMPOSE_DIR"
  if docker compose up -d --force-recreate "$SERVICE" >> "$LOG" 2>&1; then
    # Wait for the app to become healthy (max 60s) before restarting cloudflared
    for i in $(seq 1 12); do
      if docker exec pradomotica-app-1 wget -q --spider http://localhost:3000/ 2>/dev/null; then
        break
      fi
      sleep 5
    done
    # Restart cloudflared so it re-resolves the app DNS and reconnects
    docker compose restart cloudflared >> "$LOG" 2>&1
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) DEPLOY: complete" >> "$LOG"
    # Deja sólo la imagen nueva y la anterior (:rollback). Ver docker-rotate.sh.
    FROM_DEPLOY=1 /home/youruser/docker-rotate.sh
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR: docker compose up failed (exit $?)" >> "$LOG"
  fi
fi
