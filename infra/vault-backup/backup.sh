#!/bin/sh
# Copia diaria de la bóveda de Vaultwarden.
#
# - La base de datos se copia con `sqlite3 .backup`, que es seguro con el
#   servidor en marcha (un `cp` a pelo puede pillar el WAL a medias).
# - Cada copia es un .tar.gz con fecha en BACKUP_DIR; se borran las que pasan
#   de RETENTION_DAYS días.
# - El .tar.gz se escribe con otro nombre y se renombra al final, para que la
#   app nunca liste una copia a medias como buena.
# - Si falla, deja el motivo en last-error.txt: la sección Bóveda de Avyra lo
#   enseña. Al siguiente acierto se borra.
#
# Ojo: las copias viven en la misma SD que la bóveda. Protegen de un borrado o
# de una base de datos corrupta, no de que muera la tarjeta. Sácalas de la Pi.

set -u

DATA_DIR="${DATA_DIR:-/data}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_TIME="${BACKUP_TIME:-04:00}"
ERROR_FILE="$BACKUP_DIR/last-error.txt"

log() { echo "[vault-backup] $(date -Iseconds) $*"; }

fail() {
  log "ERROR: $*"
  echo "$(date -Iseconds) $*" > "$ERROR_FILE"
}

do_backup() {
  if [ ! -f "$DATA_DIR/db.sqlite3" ]; then
    # Normal hasta que se crea la primera cuenta.
    log "todavía no hay db.sqlite3, nada que copiar"
    return 0
  fi

  stamp=$(date '+%Y%m%d-%H%M%S')
  tmp=$(mktemp -d)
  final="$BACKUP_DIR/vaultwarden-$stamp.tar.gz"

  if ! sqlite3 "$DATA_DIR/db.sqlite3" ".backup '$tmp/db.sqlite3'"; then
    fail "sqlite3 .backup ha fallado"
    rm -rf "$tmp"
    return 1
  fi

  check=$(sqlite3 "$tmp/db.sqlite3" 'PRAGMA integrity_check;' 2>&1)
  if [ "$check" != "ok" ]; then
    fail "la copia no pasa integrity_check: $check"
    rm -rf "$tmp"
    return 1
  fi

  # Sin las claves RSA los tokens de sesión dejan de valer; los adjuntos y los
  # Send no están dentro de la base de datos.
  for item in config.json rsa_key.pem rsa_key.pub.pem rsa_key.der rsa_key.pub.der attachments sends; do
    [ -e "$DATA_DIR/$item" ] && cp -a "$DATA_DIR/$item" "$tmp/"
  done

  if ! tar czf "$final.partial" -C "$tmp" .; then
    fail "no se ha podido escribir $final"
    rm -rf "$tmp" "$final.partial"
    return 1
  fi
  mv "$final.partial" "$final"
  chmod 644 "$final"
  rm -rf "$tmp"
  rm -f "$ERROR_FILE"

  find "$BACKUP_DIR" -maxdepth 1 -name 'vaultwarden-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete
  log "copia hecha: $(basename "$final") ($(du -h "$final" | cut -f1))"
}

mkdir -p "$BACKUP_DIR"
log "arrancado; copia diaria a las $BACKUP_TIME, se guardan $RETENTION_DAYS días"

# Si el contenedor ha estado parado (reinicio de la Pi, actualización...) y no
# hay copia de las últimas 24 h, no se espera a la hora programada.
if [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name 'vaultwarden-*.tar.gz' -mmin -1440)" ]; then
  do_backup
fi

last_run=""
while true; do
  today=$(date '+%Y-%m-%d')
  if [ "$(date '+%H:%M')" = "$BACKUP_TIME" ] && [ "$last_run" != "$today" ]; then
    do_backup
    last_run="$today"
  fi
  sleep 30
done
