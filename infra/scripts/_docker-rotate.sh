#!/bin/bash
# Rotación de imágenes Docker y de logs propios en la Raspberry.
# Installed at /home/youruser/docker-rotate.sh
#
# Política (acordada 2026-09-30):
#   - Por cada servicio se guardan SOLO dos imágenes: la que usa su contenedor
#     y la anterior, etiquetada `<repo>:rollback`. Volver atrás es:
#        docker tag <repo>:rollback <imagen-del-compose> && docker compose up -d <servicio>
#   - Todo lo demás se borra: versiones más viejas, imágenes que ningún
#     contenedor usa, contenedores que nunca llegaron a arrancar fuera de
#     compose y la caché de build.
#   - Los logs propios (auto-deploy, este script) guardan una semana.
#
# Por qué un fichero de estado: con el almacén de imágenes de containerd (el de
# esta Pi), una imagen que pierde su etiqueta en un pull pierde también su
# repositorio y su digest, así que después ya no se sabe de qué servicio era.
# Aquí se apunta qué imagen usa cada contenedor en cada pasada; si en la
# siguiente ha cambiado, la vieja se etiqueta :rollback antes de que se pierda.
#
# Nunca borra una imagen que use un contenedor, esté parado o en marcha.
#
# Se llama al final de auto-deploy-app.sh tras cada despliegue, y a diario por
# cron para cubrir los pulls manuales (Home Assistant, etc.):
#   crontab -e
#   30 4 * * * /home/youruser/docker-rotate.sh
# Con DRY_RUN=1 sólo dice lo que haría.

LOG="/home/youruser/docker-rotate.log"
STATE="/home/youruser/.docker-rotate.state"
KEEP_LOG_DAYS=7
DRY_RUN="${DRY_RUN:-0}"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$LOG"
  if [ "$DRY_RUN" = 1 ]; then echo "$*"; fi
}
run() { if [ "$DRY_RUN" = 1 ]; then echo "DRY: $*"; else "$@" >> "$LOG" 2>&1; fi; }

# Un despliegue a medias recrea contenedores: mientras no existen, su imagen
# parecería huérfana. auto-deploy-app.sh pasa FROM_DEPLOY=1 al terminar.
if [ "${FROM_DEPLOY:-0}" != 1 ] && [ -f /tmp/auto-deploy-app.lock ]; then
  log "SKIP: auto-deploy en curso"
  exit 0
fi
exec 9> /tmp/docker-rotate.lock
flock -n 9 || exit 0

# Repositorio de una referencia de imagen: sin :tag ni @digest.
repo_of() {
  local ref=${1%@*}
  local last=${ref##*/}
  [[ "$last" == *:* ]] && ref=${ref%:*}
  echo "$ref"
}

# ── Anterior → :rollback ────────────────────────────────────────────────────

# "contenedor<TAB>repo<TAB>id-imagen" de cada contenedor existente.
NOW=$(docker ps -aq | xargs -r docker inspect --format '{{.Name}}	{{.Config.Image}}	{{.Image}}' |
  while IFS=$'\t' read -r name ref id; do printf '%s\t%s\t%s\n' "${name#/}" "$(repo_of "$ref")" "$id"; done)

if [ -f "$STATE" ]; then
  while IFS=$'\t' read -r name repo id; do
    old=$(awk -F'\t' -v n="$name" '$1 == n {print $3}' "$STATE")
    [ -z "$old" ] || [ "$old" = "$id" ] && continue
    docker image inspect "$old" > /dev/null 2>&1 || continue
    [ "$(docker image inspect "$repo:rollback" --format '{{.Id}}' 2>/dev/null)" = "$old" ] && continue
    log "TAG $repo:rollback -> ${old:7:12} ($name cambió a ${id:7:12})"
    run docker tag "$old" "$repo:rollback"
  done <<< "$NOW"
fi
[ "$DRY_RUN" = 1 ] || printf '%s\n' "$NOW" > "$STATE"

# ── Borrado ─────────────────────────────────────────────────────────────────

# Contenedores que nunca arrancaron y no son de ningún compose (restos de
# pruebas con `docker run`). Los de compose se respetan aunque estén parados.
for c in $(docker ps -aq --filter status=created); do
  [ -n "$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project"}}')" ] && continue
  log "RM contenedor $(docker inspect "$c" --format '{{.Name}} ({{.Config.Image}})')"
  run docker rm "$c"
done

IN_USE=$(docker ps -aq | xargs -r docker inspect --format '{{.Image}}' | sort -u)
ROLLBACK=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep ':rollback$' |
  xargs -r docker image inspect --format '{{.Id}}' | sort -u)
KEEP=$(printf '%s\n%s\n' "$IN_USE" "$ROLLBACK" | grep -v '^$' | sort -u)

# Etiquetas sobrantes sobre imágenes que se guardan (p. ej. un :rollback de un
# servicio que ya no existe, o una etiqueta puesta a mano): se quitan sin
# borrar la imagen.
docker images --format '{{.Repository}}:{{.Tag}}' | grep -v '<none>' | while read -r ref; do
  id=$(docker image inspect "$ref" --format '{{.Id}}')
  grep -qx "$id" <<< "$KEEP" || continue
  repo=$(repo_of "$ref")
  awk -F'\t' -v r="$repo" '$2 == r' <<< "$NOW" | grep -q . && continue
  log "UNTAG $ref"
  run docker rmi "$ref"
done

# Todo lo demás, fuera.
for id in $(docker images -aq --no-trunc | sort -u); do
  grep -qx "$id" <<< "$KEEP" && continue
  log "RMI ${id:7:12} $(docker image inspect "$id" --format '{{.RepoTags}} {{.Created}}')"
  run docker rmi -f "$id"
done

# Caché de build (cups, recorder): se regenera al volver a construir.
run docker builder prune -af

# ── Logs propios: una semana ────────────────────────────────────────────────

if [ "$DRY_RUN" != 1 ]; then
  CUTOFF=$(date -u -d "-$KEEP_LOG_DAYS days" +%Y-%m-%dT%H:%M:%SZ)
  for f in /home/youruser/auto-deploy-app.log "$LOG"; do
    [ -f "$f" ] || continue
    # Las líneas empiezan por fecha ISO; las que no (salida de docker compose)
    # siguen a la última línea con fecha.
    awk -v c="$CUTOFF" '/^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T/ { keep = ($1 >= c) } keep' "$f" > "$f.tmp" &&
      mv "$f.tmp" "$f"
  done
fi

log "DONE"
