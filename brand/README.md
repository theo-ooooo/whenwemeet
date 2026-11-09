# brand/

언제볼까 로고 시안. 규칙과 토큰은 `docs/설계/디자인토큰.md`.

| 폴더 | 안 |
|------|----|
| `안1/` | 겹치는 두 날 — 두 장의 날이 겹치는 자리에 점 하나 |
| `안2/` | 물음표 말풍선 — "언제 볼까?" 말풍선, 물음표의 점이 날짜 칸 |
| `안3/` | 모이는 날 — 달력 점 격자, 두 점이 가운데 한 날로 모인다 |

각 폴더: `logo-symbol.svg`, `logo-horizontal(-dark).svg`, `logo-stacked(-dark).svg`, `app-icon.svg`.
`비교.png` 가 세 안 나란히 보기. 확정되면 그 안만 남기고 `apps/web/public/` 아이콘을 다시 생성한다.

워드마크는 Pretendard ExtraBold 를 패스로 변환한 것이라 폰트 없이도 동일하게 보인다.
PNG 아이콘은 SVG 에서 생성 (sharp + opentype.js, 스크립트는 저장소 밖).
