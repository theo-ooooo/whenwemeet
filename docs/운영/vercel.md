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
  | `APPLE_LOGIN_ENABLED` | `1` (API 애플 설정 확인 후) | (넣지 않음) | - |
  | `APPLE_TEAM_ID` | Apple Team ID | (넣지 않음) | - |
  | `EMAIL_APP_LINK_ENABLED` | iOS 앱 1.1.1 이 퍼진 뒤 `1` (#271, D-177) | (넣지 않음) | - |
  | `ANDROID_CERT_SHA256` | 서명 인증서 SHA-256, 쉼표 구분 | (넣지 않음) | - |
  | `APP_STORE_LIVE` | 스토어 출시 승인 후 `1` (또는 `ios`, `android`) | (넣지 않음) | - |
  - `APPLE_TEAM_ID`, `ANDROID_CERT_SHA256` 은 앱 딥링크 검증 파일(`/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`)에 쓰인다. 비어 있으면 두 주소가 404. 배포 후 `curl -i https://whenwemeet.day/.well-known/assetlinks.json` 이 리다이렉트 없이 200 `application/json` 인지 확인
  - Preview(develop, PR 브랜치) 는 메모리 목으로 떠서 운영 API, DB, 카카오를 건드리지 않는다
- **Build and Deployment > Root Directory**: `apps/web`, "Include files outside the root directory in the Build Step" 켬(기본), "Skip deployments when there are no changes to the root directory or its dependencies" 켬(기본, API 만 바뀐 커밋은 웹을 건너뜀)
- **Build and Deployment > Node.js Version**: 24.x (package.json `engines` 가 우선하므로 확인만)
- **Functions > Function Regions**: `Singapore (sin1)` 로 표시되는지 확인 (`vercel.json` 이 지정)
  - `APP_STORE_LIVE` 는 초대 화면의 "앱 설치하기" 스토어 이동 스위치 (#154). 출시 전에는 넣지 않는다 (없는 앱의 스토어 페이지로 보내지 않게). 값 설명은 [배포.md](./배포.md) 환경 변수 표
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

## 5. 공유 미리보기 (Open Graph, #154)
- 이미지는 Next 서버가 그린다 (#159, `next/og` ImageResponse, nodejs 런타임). 사이트 기본은 route handler `apps/web/src/app/og/route.tsx` (`https://whenwemeet.day/og`, 하루 캐시), 초대 화면 `/join/<코드>` 는 `app/og/join/[code]/route.tsx` (`https://whenwemeet.day/og/join/<코드>`) 가 팀 이름, 멤버 수를 넣어 그린다 (공개 API `GET /v1/invites/<코드>` 를 2.5초 안에 못 받거나 코드가 없으면 일반 초대 카드). 초대 이미지 응답은 `Cache-Control: s-maxage=300`(일반 카드는 60)
- 초대 화면 `og:title` 은 "<팀 이름> 팀에 초대받았어요 - 언제볼까" (실패하면 "초대받았어요")
- 그림은 `app/_og/card.tsx`, 글꼴은 `app/_og/fonts/Pretendard-*.otf` (SIL OFL, `next.config.ts outputFileTracingIncludes` 로 함수에 포함). 팀 이름에 이모지가 있으면 next/og 가 Twemoji 를 CDN 에서 받아 그린다
- (#204) 메타데이터 파일 규칙(`app/opengraph-image.tsx`)을 쓰지 않는다. 그 규칙은 하위 모든 페이지 함수에 글꼴과 `@vercel/og` 를 끌어들여 페이지 함수가 약 24MB 커졌다. og:image 주소는 `lib/site.ts` 의 `SITE_OG_IMAGE`, `inviteOgImage(code)` 로 `layout.tsx`, `join/[code]/page.tsx` 의 metadata 에 직접 단다. 옛 주소 `/opengraph-image`, `/twitter-image`, `/join/<코드>/opengraph-image`, `/join/<코드>/twitter-image` 는 `next.config.ts redirects` 가 새 주소로 308. 함수 크기 기준선은 [번들.md](./번들.md)
- 확인: `curl -s -A 'facebookexternalhit/1.1; kakaotalk-scrap/1.0' https://whenwemeet.day/join/<코드> | grep -o '<meta property="og:[^>]*>'`
- **카카오는 미리보기를 캐시한다.** 이미지나 문구를 바꾼 뒤, 또는 배포 전에 한 번 공유해 빈 카드가 캐시된 주소는 [카카오 공유 디버거](https://developers.kakao.com/tool/debugger/sharing) 에 주소를 넣고 "캐시 초기화" 를 누른다 (카카오 개발자 계정 로그인 필요). 초대 링크는 코드마다 주소가 달라 새 코드는 바로 새로 읽는다
