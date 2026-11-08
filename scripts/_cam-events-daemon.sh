#!/bin/sh
# Detection webhook daemon for YiHack cameras (sound, human, animal).
# Installed at /tmp/sd/yi-hack/script/events_daemon.sh on EVERY camera — the
# same file for both rooms: it reads the webhook URL (device id + token) from
# the camera's own webhook.sh, so no secret lives in this script.
#
# Why a daemon and not the old per-minute cron scripts: yi-hack's ipc2file
# creates /tmp/onvif_notify_server/<event> while a detection is active and
# removes it a few seconds later. A cron check once a minute only saw the file
# if the detection happened to straddle the exact minute, so sound events
# almost never reached Avyra (1 in three months). Their lock files could also
# be left behind (seen 2026-10-12) and then every later run exited at once.
#
# Started (and restarted if it dies) by sound_webhook.sh, which crond runs
# every minute. Motion stays on webhook.sh: it keys off the SD clip files,
# which persist, and that path works.

EVENT_DIR="/tmp/onvif_notify_server"
WGET="/tmp/sd/yi-hack/usr/bin/wget"
PID_FILE="/tmp/.events_daemon.pid"
COOLDOWN=30   # seconds between two webhooks of the same type

BASE_URL=$(grep -o 'https://[^"]*' /tmp/sd/yi-hack/script/webhook.sh | sed 's/type=motion/type=__TYPE__/')
[ -n "$BASE_URL" ] || exit 1

echo $$ > "$PID_FILE"

# "<file in EVENT_DIR>:<webhook type>"
EVENTS="sound_detection:sound baby_crying:sound human_detection:human animal_detection:animal"

LAST_sound=0
LAST_human=0
LAST_animal=0
SEEN=""

while true; do
    NOW=$(date +%s)
    PRESENT=""
    for pair in $EVENTS; do
        file=${pair%%:*}
        type=${pair##*:}
        [ -f "$EVENT_DIR/$file" ] || continue
        PRESENT="$PRESENT $file"
        # Rising edge only: a file that stays put is one detection, not many.
        case " $SEEN " in *" $file "*) continue ;; esac
        eval last=\$LAST_$type
        if [ $((NOW - last)) -ge $COOLDOWN ]; then
            eval LAST_$type=$NOW
            url=$(echo "$BASE_URL" | sed "s/__TYPE__/$type/")
            $WGET -q -O /dev/null -T 20 --no-check-certificate --post-data='' "$url" 2>/dev/null &
        fi
    done
    SEEN="$PRESENT"
    sleep 1
done
