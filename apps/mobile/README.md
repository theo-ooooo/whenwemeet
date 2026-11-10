# apps/mobile — 언제볼까 앱 셸 (Expo)

`whenwemeet.day` 를 웹뷰로 띄우고, 웹이 못 하는 것(네이티브 로그인, 유니버설 링크/앱 링크, 공유 시트, 햅틱, 오프라인 화면, 당겨서 새로고침, Android 뒤로가기)만 네이티브로 한다. 기획 `docs/기획/앱.md`, 설계 `docs/설계/앱.md`, 담당 `agents/mobile.md`.

- Expo SDK 58 (React Native 0.88, 새 아키텍처), CNG: `ios/`, `android/` 는 생성물이라 커밋하지 않는다
- 카카오 SDK(`@react-native-kakao/*`)와 로컬 모듈(`modules/cookie-flush`)이 있어 **Expo Go 로는 안 뜬다**. development 빌드를 쓴다
- 빌드와 배포 절차, 계정과 시크릿: [`docs/운영/앱-빌드.md`](../../docs/운영/앱-빌드.md)

## 명령

```bash
pnpm --filter @whenwemeet/mobile test     # jest-expo 단위 테스트 (브리지, 링크, PKCE, API 봉투)
pnpm --filter @whenwemeet/mobile lint     # eslint + tsc --noEmit
pnpm --filter @whenwemeet/mobile start    # Metro (development 빌드를 설치한 기기에서 접속)
pnpm --filter @whenwemeet/mobile icons    # brand/logo-symbol.svg → assets/*.png 다시 생성
npx expo-doctor                           # apps/mobile 에서
```

## 구조

| 경로 | 내용 |
|------|------|
| `app.config.ts` | 번들/패키지 `day.whenwemeet.app`, scheme, associatedDomains, intentFilters, 플러그인, 환경 변수 → `extra` |
| `eas.json` | development / preview / production 프로필 |
| `src/App.tsx` | 웹뷰 + 그 위에 뜨는 로그인 화면, 딥링크 수신 |
| `src/screens/` | `WebScreen`(웹뷰, 브리지, 뒤로가기, 새로고침), `LoginScreen`, `OfflineScreen` |
| `src/bridge/messages.ts` | 웹 → 셸 메시지 5종 검증 (설계 4.2) |
| `src/links/urls.ts` | 허용 도메인 판정, 딥링크 → 웹뷰 주소, `/auth/app` 주소 |
| `src/auth/` | 카카오/애플 로그인 → handoff, verifier/challenge(PKCE S256), nonce |
| `modules/cookie-flush/` | Android `CookieManager.flush()` 로컬 Expo 모듈 |

## 환경 변수

`.env.example` 참고. 전부 앱에 들어가는 **공개값**(카카오 네이티브 앱 키는 원래 앱 바이너리에서 꺼낼 수 있는 값). 카카오 Client Secret, Admin 키, Apple `.p8`, `JWT_SECRET` 은 여기 두지 않는다.
