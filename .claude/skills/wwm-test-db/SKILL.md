---
name: wwm-test-db
description: 언제볼까 API 테스트(e2e, 마이그레이션)를 돌릴 때 쓰는 전용 DB 규칙. apps/api 의 pnpm test, test:e2e, prisma migrate 를 실행하거나 서브에이전트에 API 작업을 맡길 때 반드시 따른다.
---

# 전용 테스트 DB

공용 `whenwemeet_test` 에 붙으면 병렬 작업끼리 데이터와 마이그레이션 기록이 섞인다. .env 가 없는 워크트리는 기본값으로 공용 DB 에 붙으니 매번 지정한다.

1. 작업마다 DB 하나: `mysql -h127.0.0.1 -P3307 -uroot -e 'CREATE DATABASE wwm_<이슈>_test'`
2. API 명령마다 두 변수를 **모두** 앞에 붙인다
   ```sh
   DATABASE_URL=mysql://root@127.0.0.1:3307/wwm_<이슈>_test \
   TEST_DATABASE_URL=mysql://root@127.0.0.1:3307/wwm_<이슈>_test \
   pnpm --filter @whenwemeet/api test:e2e
   ```
3. 끝나면 `DROP DATABASE wwm_<이슈>_test`
4. 서브에이전트에게는 워크트리 경로와 이 두 변수를 프롬프트에 그대로 적어 준다. 서브에이전트 셸은 다른 디렉토리에서 시작하니 **명령마다 `cd <워크트리>`** 를 붙이게 한다

## 금지
- `.env`, `.env.*` 읽기 (거부 규칙에 걸리고 비밀값이 들어 있다)
- 운영 DB 에 테스트 쿼리. 운영 데이터 확인은 사용자에게 알린 뒤 railway ssh 로만
