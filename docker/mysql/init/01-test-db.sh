#!/bin/sh
# MySQL 컨테이너 첫 기동 시 한 번만 실행된다 (볼륨이 비어 있을 때).
# - 테스트용 DB `${MYSQL_DATABASE}_test` 생성 (apps/api 의 TEST_DATABASE_URL)
# - 앱 계정에 전체 권한 부여: Prisma `migrate dev` 가 섀도 DB 를 만들었다 지우려면 CREATE/DROP DATABASE 권한이 필요하다
# 이미 만들어진 볼륨에는 반영되지 않으니, 다시 적용하려면 `docker compose down -v` 후 재기동.
set -eu

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_test\`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON *.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
