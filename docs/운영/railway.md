# Railway 설정 (API + MySQL)

사용자가 직접 하는 콘솔 작업. 비밀값은 Railway 변수에만 넣고 문서, 이슈, 커밋에 쓰지 않는다. 전체 흐름과 변수 목록은 [배포.md](./배포.md).

> Railway 의 `railway.json`/`railway.toml`(Config as Code) 은 폐기 예정(2026-12-01 이후 읽지 않음) 이라 저장소에 두지 않는다. 설정은 아래처럼 대시보드에서 한다. 빌드 방법은 저장소의 `apps/api/Dockerfile` 이 전부 들고 있다.

## 0. 계정과 플랜
1. [railway.com](https://railway.com) 에 GitHub 계정(`theo-ooooo`) 으로 가입. 처음엔 Trial($5 크레딧, 30일)
2. 오픈 전에 Workspace > Billing 에서 **Hobby** 로 업그레이드 (월 $5, 사용량 $5 포함). Trial 이 끝나면 서비스가 멈춘다
3. Account Settings > Preferred Region 을 **Southeast Asia (Singapore)** 로 (이후 만드는 서비스의 기본 리전)
4. Workspace > Usage 에서 Usage Limit(예: $15) 과 알림을 걸어 둔다

## 1. 프로젝트와 MySQL
1. Dashboard > **New Project** > **Deploy MySQL** (또는 빈 프로젝트 > `+ Create` > Database > MySQL). 프로젝트 이름 `whenwemeet`
2. MySQL 서비스 > Settings > **Region** 이 Southeast Asia (Singapore) 인지 확인
3. MySQL 서비스 > Settings > Networking 의 **Public Networking(TCP Proxy) 은 만들지 않는다** (API 는 사설망 `mysql.railway.internal` 로 붙고, 공개 프록시는 전송량이 과금된다). 로컬에서 들여다볼 일이 있으면 그때만 켰다가 끈다
4. Variables 탭에 `MYSQL_URL` 이 생긴 것만 확인 (값은 복사하지 않는다)

## 2. API 서비스 (GitHub 저장소)
1. 프로젝트 캔버스 > `+ Create` > **GitHub Repo** > `theo-ooooo/whenwemeet` (처음이면 Railway GitHub 앱에 저장소 접근 허용)
2. 생성된 서비스 이름을 `api` 로 바꾼다
3. **Variables** 에 먼저 넣는다 (Raw Editor 로 한 번에 붙여도 됨). 값은 [배포.md](./배포.md) "API" 표 참고

   ```
   RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile
   DATABASE_URL=${{MySQL.MYSQL_URL}}
   WEB_ORIGIN=https://whenwemeet.day
   JWT_SECRET=<openssl rand -base64 48 결과>
   JWT_EXPIRES_IN=30d
   KAKAO_CLIENT_ID=<REST API 키>
   KAKAO_CLIENT_SECRET=<Client Secret>
   KAKAO_REDIRECT_URI=https://api.whenwemeet.day/v1/auth/kakao/callback
   KAKAO_ADMIN_KEY=<Admin 키>
   R2_ACCOUNT_ID=<계정 ID>
   R2_ACCESS_KEY_ID=<운영 버킷 토큰>
   R2_SECRET_ACCESS_KEY=<운영 버킷 토큰 Secret>
   R2_BUCKET=whenwemeet
   R2_PUBLIC_BASE_URL=https://images.whenwemeet.day
   ```
   - `${{MySQL.MYSQL_URL}}` 의 `MySQL` 은 DB 서비스 이름이다. 이름을 바꿨다면 그 이름으로. 자동완성으로 고르면 틀리지 않는다
   - `PORT`, `NODE_ENV` 는 넣지 않는다 (Railway 가 `PORT` 주입, 이미지가 `NODE_ENV=production`)
   - 하나라도 빠지면 컨테이너가 바로 종료하고 Deploy Logs 에 빠진 이름이 찍힌다
4. **Settings > Source**
   - Root Directory: 비움 (저장소 루트. Dockerfile 이 pnpm lockfile 을 루트에서 읽는다)
   - Branch connected to production: **`main`**
   - **Wait for CI**: 켬 (`main` 의 GitHub Actions `CI` 가 실패하면 배포 건너뜀)
5. **Settings > Build**
   - Builder: Dockerfile (위 `RAILWAY_DOCKERFILE_PATH` 로 자동 인식. 대시보드에 Dockerfile Path 칸이 보이면 `apps/api/Dockerfile`)
   - **Watch Paths**: `/apps/api/**`, `/pnpm-lock.yaml` (웹만 바뀐 커밋은 API 를 다시 빌드하지 않음)
6. **Settings > Deploy**
   - Custom Start Command: 비움 (Dockerfile `CMD` 가 `prisma migrate deploy` → `node dist/main.js`)
   - **Healthcheck Path**: `/v1/health` (DB `SELECT 1` 까지 확인. 200 이 나와야 트래픽 전환. 기본 대기 300초)
   - Restart Policy: On Failure
   - Region: **Southeast Asia (Singapore)**, Replicas 1 (마이그레이션이 기동 시 돌므로 1개 유지)
7. 상단 **Deploy** 로 변경 사항 적용. Deployments 탭에서 Build Logs → Deploy Logs 에 `All migrations have been successfully applied.` 와 `Nest application successfully started` 가 보이면 성공
8. Settings > Networking > **Generate Domain** 으로 임시 `*.up.railway.app` 주소를 받아 `https://<임시주소>/v1/health` 가 `{"status":200,"data":{"ok":true},"message":"OK"}` 인지 확인

## 3. 커스텀 도메인 `api.whenwemeet.day`
1. API 서비스 > Settings > Networking > **Custom Domain** > `api.whenwemeet.day` 입력. 포트를 물으면 Railway 가 감지한 `PORT` 값 그대로
2. Railway 가 보여 주는 두 레코드를 Cloudflare > `whenwemeet.day` > DNS > Records 에 추가
   | 종류 | 이름 | 값 | Proxy status |
   |------|------|----|--------------|
   | CNAME | `api` | Railway 가 준 `xxxx.up.railway.app` | **DNS only (회색 구름)** |
   | TXT | `_railway-verify.api` | Railway 가 준 값 | - |
3. Railway 화면의 도메인 옆이 초록 체크(인증서 발급 완료) 가 될 때까지 대기 (수 분~수십 분)
4. `https://api.whenwemeet.day/v1/health` 확인
5. 임시 `*.up.railway.app` 도메인은 지워도 된다 (healthcheck 는 도메인과 무관)

Proxy(주황 구름) 를 꼭 켜고 싶다면: 먼저 회색으로 인증서 발급을 끝낸 뒤 켜고, Cloudflare SSL/TLS > Overview 를 **Full** 로 (Full (strict) 아님, Flexible 은 리다이렉트 루프). 이 서비스는 API 앞단 캐시가 필요 없어서 회색을 기본으로 한다.

## 4. 백업
MySQL 서비스 > **Backups** 탭
- Schedule: **Daily**(6일 보관) + **Weekly**(27일 보관) 켬. 증분이라 비용은 볼륨 단가($0.15/GB-월) 로 소량
- 큰 마이그레이션이 든 릴리스 전에는 **Create Backup** 으로 수동 백업 (볼륨 크기의 50% 까지)
- 복원: Backups 에서 날짜 고르고 Restore → 캔버스 상단 변경 사항(Details) 확인 → Deploy. 새 볼륨이 원래 경로에 붙고 이전 볼륨은 분리된 채 남는다
- 볼륨을 Wipe 하면 백업도 같이 지워지니 하지 않는다

## 5. 운영 중
- 로그: API 서비스 > Deployments > 해당 배포 > Deploy Logs (Hobby 는 보관 기간이 짧다)
- 롤백: Deployments 목록에서 직전 성공 배포의 `⋮` > Rollback ([배포.md](./배포.md) "롤백")
- 재배포: 같은 커밋을 다시 띄우려면 `⌘K` > Deploy Latest Commit (Watch Paths 때문에 빈 커밋은 배포되지 않음)
- 비밀값 교체(`JWT_SECRET` 등) 는 Variables 에서 바꾸고 Deploy. `JWT_SECRET` 을 바꾸면 모든 사용자가 다시 로그인해야 한다
