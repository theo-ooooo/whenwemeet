# 운영 MySQL 일일 백업 (Railway cron 서비스 db-backup). mysqldump → gzip → R2(whenwemeet-backups)
# 운영 DB 와 같은 MySQL 8.4 클라이언트를 쓴다. 업로드는 rclone (R2 공식 지원). 이미지의 curl 7.76 은 R2 서명이 맞지 않았다
FROM mysql:8.4
ARG RCLONE_VERSION=v1.68.2
RUN microdnf install -y gzip unzip && microdnf clean all \
 && curl -fsSL -o /tmp/rclone.zip "https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-amd64.zip" \
 && unzip -q /tmp/rclone.zip -d /tmp \
 && install -m 0755 /tmp/rclone-${RCLONE_VERSION}-linux-amd64/rclone /usr/local/bin/rclone \
 && rm -rf /tmp/rclone*
COPY backup.sh /backup.sh
RUN chmod +x /backup.sh
ENTRYPOINT ["/backup.sh"]
