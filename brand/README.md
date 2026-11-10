# brand/

언제볼까 로고 원본. 규칙과 토큰은 `docs/설계/디자인토큰.md`.

컨셉 "겹치는 두 날": 두 장의 날(둥근 사각형)이 겹치는 자리에 점 하나 — 우리가 만나는 그 시간. 하늘과 분홍은 서로 다른 두 사람(기본 멤버 색), 겹친 보라가 브랜드 색.

| 파일 | 내용 |
|------|------|
| `logo-symbol.svg` | 심볼 96×96 |
| `logo-horizontal.svg`, `logo-horizontal-dark.svg` | 심볼 + 워드마크 (밝은/어두운 배경) |
| `logo-stacked.svg`, `logo-stacked-dark.svg` | 세로 조합 |
| `app-icon.svg` | 512 앱 아이콘 원본 |
| `비교.png` | 선정 당시 3안 비교 (기록용) |

워드마크는 Pretendard ExtraBold 를 패스로 변환한 것이라 폰트 없이도 동일하게 보인다.
`apps/web/public/` 의 PNG 아이콘은 `app-icon.svg`, `logo-symbol.svg` 에서 생성 (sharp).
앱 아이콘(`icon-192/512`, `apple-touch-icon`, `icon-maskable-192/512`)은 `pnpm --filter @whenwemeet/web icons` (`apps/web/scripts/gen-icons.mjs`) 로 다시 만든다.
심볼 도형을 바꾸면 이 스크립트의 `SYMBOL` 도 같이 고친다. `favicon-32.png`, `icon.png` 은 심볼만 쓴 기존 파일.

| 파일 | 용도 | 규칙 |
|------|------|------|
| `icon-192.png`, `icon-512.png` | manifest `any` | 둥근 모서리, 바깥 투명 |
| `icon-maskable-192.png`, `icon-maskable-512.png` | manifest `maskable` (Android) | 꽉 찬 불투명, 심볼이 지름 80% 안전 원 안 |
| `apple-touch-icon.png` | iOS 홈 화면 180 | 꽉 찬 불투명 (iOS 가 모서리를 깎는다) |
