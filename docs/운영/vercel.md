# Vercel 설정 (웹)

사용자가 직접 하는 콘솔 작업. 전체 흐름은 [배포.md](./배포.md).

저장소에 있는 설정
- `apps/web/vercel.json`: 함수 리전 `sin1` (싱가포르. API, DB 와 같은 지역. Hobby 는 리전 1개만 가능)
- `apps/web/package.json` `engines.node = 24.x` (CI 와 같은 Node. Vercel 기본은 26)

## 1. 프로젝트
1. [vercel.com](https://vercel.com) 에 GitHub 계정(`theo-ooooo`) 으로 가입 (Hobby, 무료)
2. **Add New > Project** > `theo-ooooo/whenwemeet` Import
3. Import 화면에서
   - Framework Preset: **Next.js** (자동)
   - **Root Directory: `apps/web`** (Edit 눌러 선택)
   - Build and Output Settings: 기본값 그대로. 루트 `pnpm-lock.yaml` 과 `packageManager: pnpm@9.12.3` 로 pnpm 을 알아서 쓰고, 설치는 저장소 루트에서 한다
     - Install Command: (기본) `pnpm install`
     - Build Command: (기본) `next build`
   - Environment Variables: `API_URL` = `https://api.whenwemeet.day` (Production)
4. Deploy. 첫 배포는 기본 브랜치(`develop`) 로 나갈 수 있으니 아래 2 를 바로 한다

## 2. 브랜치와 환경
Project > Settings
- **Environments > Production > Branch Tracking** (화면에 따라 Git > Production Branch): `main` 으로 변경 (기본은 저장소 기본 브랜치 `develop`)
- **Environment Variables**
  | 이름 | Production | Preview | Development |
  |------|-----------|---------|-------------|
  | `API_URL` | `https://api.whenwemeet.day` | (넣지 않음) | (넣지 않음) |
  | `API_MOCK` | (절대 넣지 않음) | `1` | - |
  - Preview(develop, PR 브랜치) 는 메모리 목으로 떠서 운영 API, DB, 카카오를 건드리지 않는다
- **Build and Deployment > Root Directory**: `apps/web`, "Include files outside the root directory in the Build Step" 켬(기본), "Skip deployments when there are no changes to the root directory or its dependencies" 켬(기본, API 만 바뀐 커밋은 웹을 건너뜀)
- **Build and Deployment > Node.js Version**: 24.x (package.json `engines` 가 우선하므로 확인만)
- **Functions > Function Regions**: `Singapore (sin1)` 로 표시되는지 확인 (`vercel.json` 이 지정)
- 환경 변수를 바꾼 뒤에는 Deployments 에서 최신 Production 을 **Redeploy** 해야 반영된다

## 3. 도메인 `whenwemeet.day`
1. Project > Settings > **Domains** > Add > `whenwemeet.day`. `www.whenwemeet.day` 도 추가하고 `whenwemeet.day` 로 리다이렉트(308) 를 고른다
2. Vercel 이 보여 주는 레코드를 Cloudflare > `whenwemeet.day` > DNS 에 추가
   | 종류 | 이름 | 값 | Proxy status |
   |------|------|----|--------------|
   | A | `@` | Vercel 화면의 값 (보통 `76.76.21.21`) | **DNS only (회색 구름)** |
   | CNAME | `www` | Vercel 화면의 값 | DNS only |
   - `@` 에 이미 다른 A/AAAA 레코드가 있으면 지운다
   - 프록시를 켜면 Vercel 인증서 발급, 검증이 막힐 수 있어 끈다
3. Domains 화면에서 두 도메인이 Valid Configuration 이 될 때까지 대기
4. `https://whenwemeet.day` 접속 → 로그인 화면, `https://whenwemeet.day/api/health` 가 `{"status":200,"data":{"ok":true},...}` 이면 웹 → API 연결 정상

## 4. 운영 중
- 롤백: Deployments > 직전 Production 배포 `⋯` > **Instant Rollback**
- 로그: Project > Logs (Hobby 는 1시간 보관)
- Hobby 는 **비상업 용도만** 허용. 수익 모델이 생기면 Pro 로 옮긴다 ([배포.md](./배포.md) "비용")
