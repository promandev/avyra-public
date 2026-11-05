#!/bin/sh
# Daily cleanup at 03:00 (Madrid time)
# Deletes: expired sessions, old login attempts (>30d), old audit log (>90d), expired invites
while true; do
  NOW=$(date '+%H:%M')
  if [ "$NOW" = "03:00" ]; then
    echo "[db-cleanup] $(date -Iseconds) — starting"
    psql "$DATABASE_URL" \
      -c "DELETE FROM sessions WHERE expires_at < NOW();" \
      -c "DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '30 days';" \
      -c "DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '90 days';" \
      -c "DELETE FROM household_invites WHERE expires_at < NOW() AND accepted_at IS NULL;"
    echo "[db-cleanup] $(date -Iseconds) — done"
  fi
  sleep 60
done
