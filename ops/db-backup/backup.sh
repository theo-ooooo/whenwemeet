#!/bin/bash
# 필요한 변수 (Railway db-backup 서비스):
#   MYSQLHOST MYSQLPORT MYSQLUSER MYSQLPASSWORD MYSQLDATABASE  (MySQL 서비스 참조 변수)
#   R2_ENDPOINT (https://<account>.r2.cloudflarestorage.com), R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# 보관 기간은 R2 버킷 수명 주기 규칙(30일 후 삭제)이 맡는다
set -euo pipefail
: "${MYSQLHOST:?}" "${MYSQLPORT:?}" "${MYSQLUSER:?}" "${MYSQLPASSWORD:?}" "${MYSQLDATABASE:?}"
: "${R2_ENDPOINT:?}" "${R2_BUCKET:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=/tmp/whenwemeet-$TS.sql.gz
export MYSQL_PWD="$MYSQLPASSWORD"

mysqldump -h "$MYSQLHOST" -P "$MYSQLPORT" -u "$MYSQLUSER" \
  --single-transaction --routines --no-tablespaces --set-gtid-purged=OFF "$MYSQLDATABASE" | gzip -9 > "$OUT"

# 덤프가 끝까지 쓰였는지 (마지막 줄 "-- Dump completed") 와 gzip 무결성 확인
gzip -t "$OUT"
zcat "$OUT" | tail -1 | grep -q "Dump completed" || { echo "[db-backup] 덤프가 완료 표시 없이 끝났다" >&2; exit 1; }

SIZE=$(stat -c %s "$OUT")
# rclone 설정은 환경 변수로만 (파일 없음)
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
  RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT" RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
rclone copyto "$OUT" "r2:$R2_BUCKET/mysql/$(basename "$OUT")" --s3-no-check-bucket
echo "[db-backup] uploaded mysql/$(basename "$OUT") ($SIZE bytes)"
