#!/bin/sh
# Installed at /tmp/sd/yi-hack/script/sound_webhook.sh (crond runs it every minute).
# It no longer polls for sound itself: it keeps events_daemon.sh running, which
# checks sound/human/animal detections every second. See _cam-events-daemon.sh.

PID_FILE="/tmp/.events_daemon.pid"
DAEMON="/tmp/sd/yi-hack/script/events_daemon.sh"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    exit 0
fi
sh "$DAEMON" </dev/null >/dev/null 2>&1 &
