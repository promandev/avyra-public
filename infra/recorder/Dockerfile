FROM alpine:3.20
RUN apk add --no-cache ffmpeg jq
COPY record.sh /usr/local/bin/record.sh
RUN chmod +x /usr/local/bin/record.sh
ENTRYPOINT ["record.sh"]
