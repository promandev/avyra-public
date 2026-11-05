#!/bin/sh
# Motion webhook for YiHack camera — installed at /tmp/sd/yi-hack/script/webhook.sh
# Cámara Salón (device 00000000-0000-0000-0000-000000000000; serial __CAMERA_SERIAL__). Identify it by serial/MAC, NOT by IP: DHCP moves it.
# Triggered every minute by crond; calls the Avyra webhook when new event files appear.

WEBHOOK_URL="https://app.example.com/api/cameras/00000000-0000-0000-0000-000000000000/motion?type=motion&token=__WEBHOOK_TOKEN__"
RECORD_DIR="/tmp/sd/record"
TIMESTAMP_FILE="/tmp/sd/yi-hack/etc/.last_webhook"
WGET="/tmp/sd/yi-hack/usr/bin/wget"
LOCK_FILE="/tmp/.webhook.lock"

# Prevent concurrent execution
[ -f "$LOCK_FILE" ] && exit 0
touch "$LOCK_FILE"

# First run: just create the timestamp and exit
if [ ! -f "$TIMESTAMP_FILE" ]; then
    touch "$TIMESTAMP_FILE"
    rm -f "$LOCK_FILE"
    exit 0
fi

# Find any event .mp4 file newer than our last-run timestamp
FOUND=$(/tmp/sd/yi-hack/bin/busybox find "$RECORD_DIR" -name "E*.mp4" -newer "$TIMESTAMP_FILE" 2>/dev/null)

if [ -n "$FOUND" ]; then
    # Update timestamp BEFORE calling webhook to avoid duplicate triggers
    touch "$TIMESTAMP_FILE"
    $WGET -q -O /dev/null --no-check-certificate --post-data= "$WEBHOOK_URL" 2>/dev/null &
else
    touch "$TIMESTAMP_FILE"
fi

rm -f "$LOCK_FILE"
