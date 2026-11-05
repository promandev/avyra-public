#!/bin/sh
# Sound detection webhook for YiHack camera — Cámara Salón (device 00000000-0000-0000-0000-000000000000; serial __CAMERA_SERIAL__). Identify it by serial/MAC, NOT by IP: DHCP moves it.
# Installed at /tmp/sd/yi-hack/script/sound_webhook.sh
# Triggered every minute by crond; calls the Avyra webhook when sound is detected.

WEBHOOK_URL="https://app.example.com/api/cameras/00000000-0000-0000-0000-000000000000/motion?type=sound&token=__WEBHOOK_TOKEN__"
SOUND_FILE="/tmp/onvif_notify_server/sound_detection"
TIMESTAMP_FILE="/tmp/sd/yi-hack/etc/.last_sound_webhook"
WGET="/tmp/sd/yi-hack/usr/bin/wget"
LOCK_FILE="/tmp/.sound_webhook.lock"

# Prevent concurrent execution
[ -f "$LOCK_FILE" ] && exit 0
touch "$LOCK_FILE"

# Check if sound detection file exists and has recent activity
if [ -f "$SOUND_FILE" ] && [ -f "$TIMESTAMP_FILE" ]; then
    # Check if sound_detection file is newer than our timestamp
    if [ "$SOUND_FILE" -nt "$TIMESTAMP_FILE" ]; then
        touch "$TIMESTAMP_FILE"
        $WGET -q -O /dev/null --no-check-certificate --post-data='' "$WEBHOOK_URL" 2>/dev/null &
    fi
elif [ -f "$SOUND_FILE" ] && [ ! -f "$TIMESTAMP_FILE" ]; then
    # First run with sound file present
    touch "$TIMESTAMP_FILE"
fi

rm -f "$LOCK_FILE"
