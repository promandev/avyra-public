#!/bin/sh
# Exporta los accesos SSH del journal para la sección Sistema de Avyra.
#
# La app corre en un contenedor sin `journalctl` y el journal es del host, así
# que este script (cron del usuario youruser, que está en el grupo `adm`) deja
# las últimas líneas de sshd en ~/.avyra-panel/ssh.log, dentro de la carpeta
# que se monta en el contenedor.
#
# Instalación (una vez, en la Raspberry):
#   cp ~/avyra/infra/scripts/panel-ssh-export.sh ~/ && chmod +x ~/panel-ssh-export.sh
#   (crontab -l; echo '*/5 * * * * /home/youruser/panel-ssh-export.sh') | crontab -
set -eu

OUT_DIR="${HOME}/.avyra-panel"
OUT="${OUT_DIR}/ssh.log"
mkdir -p "$OUT_DIR"

# Escritura atómica: la app nunca lee un fichero a medias.
journalctl -u ssh -n 2000 --no-pager -o short-iso > "${OUT}.tmp"
mv "${OUT}.tmp" "$OUT"
