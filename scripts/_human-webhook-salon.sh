#!/bin/sh
# AI Human detection webhook for YiHack camera — Cámara Salón (device 00000000-0000-0000-0000-000000000000; serial __CAMERA_SERIAL__). Identify it by serial/MAC, NOT by IP: DHCP moves it.
# Installed at /tmp/sd/yi-hack/script/human_webhook.sh
# Triggered every minute by crond; calls the Avyra webhook when AI detects a person.

WEBHOOK_URL="https://app.example.com/api/cameras/00000000-0000-0000-0000-000000000000/motion?type=human&token=__WEBHOOK_TOKEN__"
DETECT_FILE="/tmp/onvif_notify_server/human_detection"
TIMESTAMP_FILE="/tmp/sd/yi-hack/etc/.last_human_webhook"
WGET="/tmp/sd/yi-hack/usr/bin/wget"
LOCK_FILE="/tmp/.human_webhook.lock"

# Prevent concurrent execution
[ -f "$LOCK_FILE" ] && exit 0
touch "$LOCK_FILE"

if [ -f "$DETECT_FILE" ] && [ -f "$TIMESTAMP_FILE" ]; then
    if [ "$DETECT_FILE" -nt "$TIMESTAMP_FILE" ]; then
        touch "$TIMESTAMP_FILE"
        $WGET -q -O /dev/null --no-check-certificate --post-data='' "$WEBHOOK_URL" 2>/dev/null &
    fi
elif [ -f "$DETECT_FILE" ] && [ ! -f "$TIMESTAMP_FILE" ]; then
    touch "$TIMESTAMP_FILE"
fi

rm -f "$LOCK_FILE"
