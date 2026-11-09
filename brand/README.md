# brand/

언제볼까 로고 원본. 규칙과 토큰은 `docs/설계/디자인토큰.md`.

| 파일 | 내용 |
|------|------|
| `logo-symbol.svg` | 심볼 96×96 |
| `logo-horizontal.svg`, `logo-horizontal-dark.svg` | 심볼 + 워드마크 (밝은/어두운 배경) |
| `logo-stacked.svg`, `logo-stacked-dark.svg` | 세로 조합 |
| `app-icon.svg` | 512 앱 아이콘 원본 |
| `preview.png` | 전체 미리보기 |

워드마크는 Pretendard ExtraBold 를 패스로 변환한 것이라 폰트 없이도 그대로 보인다.
`apps/web/public/` 의 PNG 아이콘은 이 SVG 에서 생성한다 (생성 스크립트는 저장소에 두지 않음, 재생성 필요 시 sharp + opentype.js).
