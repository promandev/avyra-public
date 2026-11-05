#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────────
# Arranca CUPS y da de alta la cola de la impresora.
#
#   PRINTER_URI    ipp://192.168.1.XX/ipp/print  — obligatoria para imprimir
#   PRINTER_QUEUE  deskjet                        — nombre de la cola
#
# `lpadmin -m everywhere` le pregunta sus capacidades a la impresora, así que
# falla si está apagada o dormida. Se reintenta cada minuto hasta que responda:
# no hace falta reiniciar el contenedor al encenderla.
# ───────────────────────────────────────────────────────────────────────────────
set -eu

: "${PRINTER_QUEUE:=deskjet}"

/usr/sbin/cupsd -f &
CUPSD_PID=$!

i=0
# `lpstat -r` sale con 0 también cuando cupsd aún no escucha: hay que leer lo que dice.
until [ "$(lpstat -r 2>/dev/null)" = "scheduler is running" ]; do
  i=$((i + 1))
  [ "$i" -gt 30 ] && { echo "[cups] cupsd no arranca" >&2; exit 1; }
  sleep 1
done

if [ -z "${PRINTER_URI:-}" ]; then
  echo "[cups] PRINTER_URI vacía: no se crea ninguna cola" >&2
else
  (
    # retry-job: si la impresora está apagada al mandar un trabajo, CUPS lo
    # reintenta en vez de detener la cola (que exigiría un cupsenable a mano).
    # printer-is-shared: para CUPS la app es un cliente remoto, y a una cola no
    # compartida sólo se puede imprimir desde localhost. Con Browsing No y el
    # puerto sin publicar, "compartida" no la anuncia a nadie.
    until lpadmin -p "$PRINTER_QUEUE" -E -v "$PRINTER_URI" -m everywhere \
      -o printer-error-policy=retry-job \
      -o printer-is-shared=true \
      -o media-default=iso_a4_210x297mm 2>/tmp/lpadmin.err; do
      echo "[cups] La impresora no responde en $PRINTER_URI ($(cat /tmp/lpadmin.err)); reintento en 60 s" >&2
      sleep 60
    done
    lpadmin -d "$PRINTER_QUEUE"
    echo "[cups] Cola '$PRINTER_QUEUE' lista -> $PRINTER_URI" >&2
  ) &
fi

wait "$CUPSD_PID"
