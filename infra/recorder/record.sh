#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────────
# Tablet stream recorder for Pradomotica
#
# Polls go2rtc API for streams whose name starts with "tablet-", then
# records each one via ffmpeg (RTSP pull → MP4 segments on disk).
#
# Environment variables (all optional, shown with defaults):
#   GO2RTC_URL        http://go2rtc:1984   — go2rtc HTTP API
#   RTSP_URL          rtsp://go2rtc:8554   — go2rtc RTSP output
#   RECORDINGS_DIR    /recordings          — base path for MP4 files
#   RETENTION_DAYS    30                   — auto-delete recordings older than N days
#   POLL_INTERVAL     15                   — seconds between discovery polls
#   SEGMENT_MINUTES   30                   — max duration per MP4 segment
# ───────────────────────────────────────────────────────────────────────────────
set -eu

: "${GO2RTC_URL:=http://go2rtc:1984}"
: "${RTSP_URL:=rtsp://go2rtc:8554}"
: "${RECORDINGS_DIR:=/recordings}"
: "${RETENTION_DAYS:=30}"
: "${POLL_INTERVAL:=15}"
: "${SEGMENT_MINUTES:=30}"

PIDS_DIR="/tmp/rec"
mkdir -p "$PIDS_DIR" "$RECORDINGS_DIR"

# ── helpers ────────────────────────────────────────────────────────────────────

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

# Return PID stored for a stream (empty string if none).
stored_pid() {
  local f="$PIDS_DIR/$1"
  [ -f "$f" ] && cat "$f" || true
}

# True when the given PID is alive.
is_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# Delete MP4 files older than $RETENTION_DAYS and prune empty dirs.
prune() {
  log "Retention: removing recordings older than ${RETENTION_DAYS} days…"
  find "$RECORDINGS_DIR" -name '*.mp4' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
  find "$RECORDINGS_DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
}

# ── recording ──────────────────────────────────────────────────────────────────

start_recording() {
  local stream="$1"
  local dir="$RECORDINGS_DIR/$stream/$(date +%F)"
  mkdir -p "$dir"

  # Video: copy H264 (no re-encode).
  # Audio: transcode Opus→AAC for wide MP4 compatibility.
  ffmpeg -hide_banner -loglevel warning \
    -rtsp_transport tcp \
    -stimeout 15000000 \
    -i "${RTSP_URL}/${stream}" \
    -c:v copy \
    -c:a aac -b:a 128k \
    -f segment \
    -segment_time "$((SEGMENT_MINUTES * 60))" \
    -segment_format mp4 \
    -strftime 1 \
    -reset_timestamps 1 \
    "${dir}/%H-%M-%S.mp4" </dev/null 2>&1 | while IFS= read -r line; do
      log "ffmpeg[$stream] $line"
    done &

  echo $! > "$PIDS_DIR/$stream"
  log "Recording $stream → $dir/ (PID $!)"
}

# ── lifecycle ──────────────────────────────────────────────────────────────────

stop_all() {
  log "Shutting down…"
  for f in "$PIDS_DIR"/*; do
    [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
  done
  exit 0
}
trap stop_all INT TERM

# ── main loop ──────────────────────────────────────────────────────────────────

log "Started (poll=${POLL_INTERVAL}s segment=${SEGMENT_MINUTES}min retention=${RETENTION_DAYS}d)"

TICK=0

while true; do
  # Discover tablet-* streams registered in go2rtc.
  STREAMS=$(wget -qO- "${GO2RTC_URL}/api/streams" 2>/dev/null \
    | jq -r 'keys[]' 2>/dev/null \
    | grep '^tablet-' || true)

  for sid in $STREAMS; do
    pid=$(stored_pid "$sid")
    if ! is_alive "$pid"; then
      start_recording "$sid"
    fi
  done

  # Run retention cleanup approximately once per day.
  TICK=$((TICK + 1))
  if [ "$((TICK % (86400 / POLL_INTERVAL)))" -eq 0 ]; then
    prune
  fi

  sleep "$POLL_INTERVAL"
done
