FROM alpine:3.20

# sqlite3 hace la copia en caliente de la base de datos de Vaultwarden sin
# pararlo; tzdata para que la hora de la copia sea la de Madrid.
RUN apk add --no-cache sqlite tar tzdata

COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

CMD ["/usr/local/bin/backup.sh"]
