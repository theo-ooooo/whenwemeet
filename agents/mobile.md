# 모바일 에이전트 — 언제볼까 (Expo 셸 + WebView)

## 역할
`docs/기획/앱.md`, `docs/설계/앱.md` 대로 iOS/Android 셸을 만든다. 수정 영역은 `apps/mobile/` 만. 화면과 기능은 웹(`whenwemeet.day`)이 그리고, 셸은 웹이 못 하는 것만 한다 (D-42, D-48).

## 시작 전
1. `CLAUDE.md`, 위 두 문서, `docs/설계/인증흐름.md` 읽기
2. `apps/mobile/.env.example` → `.env` (공개 가능한 값만. 아래 비밀값 규칙)
3. `pnpm --filter @whenwemeet/mobile install`, `npx expo-doctor` 통과

## 구조
```
apps/mobile/
  app.config.ts        번들/패키지 day.whenwemeet.app, scheme, associatedDomains, intentFilters, 플러그인
  eas.json             development / preview / production 프로필
  src/
    screens/           LoginScreen(카카오, 애플), WebScreen(WebView), OfflineScreen
    bridge/            메시지 타입(웹과 공유하는 계약), 수신 처리기
    auth/              카카오 SDK, expo-apple-authentication, handoff 요청
    links/             유니버설 링크/앱 링크 → 웹뷰 경로 변환
  assets/              brand/ 에서 만든 아이콘, 스플래시
```

## 규칙
- Expo SDK 는 최신 안정판 하나로 고정. 올릴 때는 `npx expo install --fix` 후 실기기 확인. bare 로 eject 하지 않고 네이티브 설정은 config plugin 으로만
- 빌드와 배포는 EAS Build, EAS Submit. 셸 JS 수정은 EAS Update, 네이티브 모듈이나 권한 변경은 스토어 빌드
- WebView 는 `whenwemeet.day` 만 띄운다. 그 밖의 도메인은 `onShouldStartLoadWithRequest` 에서 막고 외부 브라우저로 연다
- 세션은 웹 쿠키(`wwm_session`)만. 셸은 세션 JWT 를 받지도 저장하지도 않는다. 로그인 결과는 handoff 로 웹뷰에 넘긴다 (D-44)
- 브리지: 웹 → 셸은 `window.ReactNativeWebView.postMessage(JSON)`, 셸 → 웹은 `injectJavaScript` 로 정의된 이벤트만. 메시지 타입은 `docs/설계/앱.md` 목록이 전부이고, 모르는 타입과 `whenwemeet.day` 밖 origin 의 메시지는 버린다
- 앱 감지는 User-Agent 접미사(`WhenwemeetApp/<버전>`) 하나로. 웹에 다른 감지 수단을 만들지 않는다
- Android 백그라운드 진입 시 쿠키 flush, 하드웨어 뒤로가기는 웹뷰 history 우선
- 비밀값: 셸에 들어가는 값(카카오 네이티브 앱 키, 번들 ID)은 공개값이다. 카카오 Client Secret, Admin 키, Apple `.p8` 키, JWT_SECRET 은 셸과 `app.config.ts`, `eas.json` 어디에도 넣지 않는다 (API 에만)

## 테스트
- 브리지 메시지 파싱, 링크 → 경로 변환, 허용 도메인 판정은 순수 함수로 두고 jest(jest-expo) 단위 테스트
- 커밋 전 `pnpm --filter @whenwemeet/mobile test`, `lint`, `tsc --noEmit` 통과
- 네이티브 로그인, 딥링크, 공유는 시뮬레이터가 아니라 iPhone, Android 실기기에서 development 빌드로 확인하고 결과를 PR 에 적는다 (카카오톡 앱 로그인, 링크 탭 시 앱 열림, 공유 시트)

## 금지
- `apps/web/`, `apps/api/` 수정 (브리지 계약 변경은 설계 에이전트에 요청)
- 웹 화면을 셸에 다시 그리기, 설계에 없는 네이티브 기능 추가 (푸시, 위젯 등은 D-48 로 출시 후)
- WebView 안에서 카카오 웹 로그인 열기 (카카오톡 앱 호출이 실패한다)
- 비밀값 커밋, EAS 시크릿 값을 문서에 기록
