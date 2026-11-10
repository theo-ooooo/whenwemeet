# API 명세

- 이슈: #2
- prefix `/v1`. 브라우저는 웹의 `/api/<path>` 프록시로만 호출 (프록시가 `/v1/<path>` 로 전달, 인증흐름.md)

## 1. 공통

| 항목 | 규칙 |
|------|------|
| 응답 봉투 | 모든 응답은 `{ status: number, data: any, message: string, error?: any }`. `status` 는 HTTP 상태 코드와 항상 같은 값 |
| 성공 | `200 { status: 200, data, message: "OK" }`. 생성은 201. 삭제는 `data: { ok: true }`. 이 문서의 엔드포인트 표에 적힌 `{ data: ... }` 는 `data` 필드의 모양이다 |
| 실패 | `{ status, data: null, message, error: { code, details? } }`. code 는 아래 오류 표, message 는 사용자에게 바로 보여도 되는 한국어 한 문장. `details` 는 검증 실패 시 필드별 위반 목록 |
| 인증 | `Authorization: Bearer <JWT>`. 표의 인증 열이 `유저` 면 필수, `멤버` 면 추가로 경로의 `groupId` 멤버십 필요 |
| 권한 | `멤버` 검사는 서비스 메서드 첫 줄에서 `Membership(userId, groupId)` 조회. 없으면 403 FORBIDDEN. 멤버면 팀 안의 모든 자원을 읽고 쓸 수 있다 (역할 없음) |
| 날짜시각 | 응답은 ISO 8601 UTC (`2026-11-09T05:00:00.000Z`). 입력(본문 `startsAt`/`endsAt`, 쿼리 `from`/`to`)은 날짜, 시각, 오프셋(`Z` 또는 `±HH:mm`)이 모두 있어야 하며 없으면 400 VALIDATION_FAILED (D-40). 날짜만인 값(기념일)은 `YYYY-MM-DD` (KST 달력 날짜) |
| ID | 모든 모델 `Int` 자동증가. JSON 에서는 숫자. 경로 파라미터는 양의 정수만 허용(아니면 400 VALIDATION_FAILED) |
| 검증 | class-validator. 실패 시 400 VALIDATION_FAILED, message 는 첫 번째 위반 항목 |
| 문자열 공백 | 이름/제목 문자열(팀 `name`, 일정 `title`, 기념일 `name`, `displayName`, `nickname`) 은 앞뒤 공백을 잘라 검증하고 잘린 값을 저장한다. 공백만이면 길이 0 이라 400 VALIDATION_FAILED. 길이 제한도 잘린 값 기준 |
| 표시 이름 | 응답의 사람 정보는 항상 `{ userId, displayName, color, profileImageUrl }` 형태의 `member` 객체. displayName = `Membership.displayName ?? User.nickname`. 탈퇴자는 `{ userId: null, displayName: "탈퇴한 멤버", color: "#9CA3AF", profileImageUrl: null }` |

### 오류 코드

| code | HTTP | 언제 |
|------|------|------|
| VALIDATION_FAILED | 400 | DTO 검증 실패, 잘못된 쿼리 값, 본문이 JSON 이 아님(message "요청 형식이 올바르지 않아요" 고정) |
| EVENT_RANGE_INVALID | 400 | `endsAt <= startsAt`, 길이 30일 초과, 조회 범위 초과, 반복 규칙 위반 (길이 >= 주기, 종료일 < 첫 회차 날짜, 회차를 앞뒤 30일 밖으로 옮김. #187) |
| GROUP_NOT_INVITABLE | 400 | PERSONAL 팀에 초대 코드 재발급 요청 |
| GROUP_PERSONAL_LEAVE | 400 | PERSONAL 팀 나가기 시도 (탈퇴로만 삭제됨) |
| UNAUTHORIZED | 401 | 토큰 없음, 서명 불일치, 만료, sub 사용자 없음(탈퇴) |
| FORBIDDEN | 403 | 해당 팀 멤버가 아님 |
| NOT_FOUND | 404 | 팀/일정/기념일 없음 (다른 팀 자원을 가리키는 ID 포함) |
| INVITE_NOT_FOUND | 404 | 초대 코드 없음 |
| PAYLOAD_TOO_LARGE | 413 | JSON 본문이 100KB 초과 (express 기본 한도). message "요청 내용이 너무 커요". 아바타 파일 크기 초과는 해당 없음(400 VALIDATION_FAILED) |
| SOCIAL_TOKEN_INVALID | 401 | 앱 로그인의 카카오/애플 토큰 검증 실패 (앱.md 8장) |
| HANDOFF_INVALID | 401 | handoff 없음, 만료, 사용됨, verifier 불일치 (앱.md 2장) |
| APPLE_ERROR | 502 | 애플 JWKS, 토큰 교환, 폐기 실패 |
| APPLE_NOT_CONFIGURED | 503 | `APPLE_*` 미설정 |
| KAKAO_ERROR | 502 | 카카오 토큰 교환/사용자 조회/unlink 실패 |
| STORAGE_NOT_CONFIGURED | 503 | R2 환경변수 미설정 상태에서 아바타 업로드/삭제 |
| KAKAO_NOT_CONFIGURED | 503 | 카카오 환경변수 미설정 상태에서 로그인 (D-29) |
| DB_UNAVAILABLE | 503 | `GET /health` 의 DB 확인(`SELECT 1`) 실패. 배포 healthcheck 가 이 응답이면 트래픽을 넘기지 않는다 (#50) |
| INTERNAL | 500 | 그 외. message 는 "잠시 후 다시 시도해 주세요" 고정 |

### 환경 변수 (apps/api/.env)

`NODE_ENV=production` 이면 `PORT`, `JWT_EXPIRES_IN` 을 뺀 아래 값이 모두 있어야 기동한다 (`src/config/env.validation.ts`, 운영 목록은 docs/운영/배포.md).

| 이름 | 용도 |
|------|------|
| `DATABASE_URL` | `mysql://user:pass@host:3306/whenwemeet` |
| `PORT` | 기본 4000 |
| `WEB_ORIGIN` | CORS 허용 origin 이자 로그인 후 리다이렉트 대상 (`https://whenwemeet.day`, 로컬 `http://localhost:3000`) |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | HS256 비밀키, `30d` |
| `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI`, `KAKAO_ADMIN_KEY` | 인증흐름.md |
| `KAKAO_APP_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_ID`, `APPLE_SERVICE_ID`, `APPLE_REDIRECT_URI` | 앱 로그인과 애플 로그인 (앱.md 7장). 운영 기동 필수 아님, 없으면 해당 엔드포인트만 503 (D-55) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | Cloudflare R2 (S3 호환). `R2_PUBLIC_BASE_URL` 은 공개 도메인(`https://images.whenwemeet.day`). 응답의 사진 URL 은 이 값 + `File.key` 로 매번 만들므로 도메인을 바꾸면 기존 사진 URL 도 바로 바뀐다 (D-56). docs/운영/cloudflare-r2.md |

## 2. 엔드포인트

### 2.1 인증

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/health` | 없음 | - | `{ data: { ok: true } }`. DB 에 `SELECT 1` 을 보내 실패하면 503 DB_UNAVAILABLE |
| GET | `/auth/kakao` | 없음 | 쿼리 `next?` (같은 출처 상대 경로 + 쿼리, 예 `/join/ABC123?auto=1`. 규칙은 인증흐름.md 2단계, 어긋나면 `/`. 기본 `/`) | 302 → kauth 인가 페이지 |
| GET | `/auth/kakao/callback` | 없음 | 쿼리 `code`, `state` | 302 → `${WEB_ORIGIN}/auth/callback?token=<JWT>&next=<경로+쿼리, URL 인코딩>`. 실패 시 302 → `${WEB_ORIGIN}/login?error=<code>` |
| POST | `/auth/kakao/native` | 없음 | `{ accessToken, codeChallenge }` | `{ data: { handoff, expiresIn } }`. 앱 전용, 앱.md 3.1 |
| POST | `/auth/apple/native` | 없음 | `{ identityToken, authorizationCode, nonce, nickname?, codeChallenge }` | `{ data: { handoff, expiresIn } }`. iOS 앱 전용, 앱.md 3.3 |
| GET | `/auth/apple` | 없음 | 쿼리 `next?`, `client?`, `cc?` | 302 → Apple 인가 (앱.md 3.4) |
| POST | `/auth/apple/callback` | 없음 | form_post `code`, `state`, `id_token`, `user?` | 302 → 웹 `/auth/callback?token=` 또는 `whenwemeet://auth?h=` (앱.md 3.4) |
| POST | `/auth/handoff` | 없음 | `{ handoff, verifier }` | `{ data: { token } }`. 웹 서버만 호출, 앱.md 2.2 |
| GET | `/me` | 유저 | - | `{ data: { id, nickname, profileImageUrl, createdAt } }` |
| PATCH | `/me` | 유저 | `{ nickname }` (1~20자, 공백만 불가) | `{ data: { id, nickname, profileImageUrl, createdAt } }`. 닉네임은 우리 서비스 값이며 소셜 프로필과 독립 |
| POST | `/me/avatar` | 유저 | `multipart/form-data` 필드 `file` (jpeg/png/webp/heic, 10MB 이하) | `{ data: { profileImageUrl } }`. 서버가 512×512 로 리사이즈해 webp 로 R2 에 저장하고 `File(kind: AVATAR)` 행 생성, `User.avatarFileId` 교체, 이전 File 행과 객체는 삭제. 응답의 `profileImageUrl` 은 `R2_PUBLIC_BASE_URL` + `File.key` (DB 에 도메인을 저장하지 않음, 결정기록 D-56) |
| DELETE | `/me/avatar` | 유저 | - | `{ data: { profileImageUrl: null } }`. File 행과 R2 객체 삭제 후 기본 아바타(이니셜) |
| DELETE | `/me` | 유저 | - | `{ data: { ok: true } }`. 회원 탈퇴 (2.7). `File(ownerId = me)` 전부 객체 삭제 후 행 삭제 |

로그아웃은 API 호출 없이 웹이 쿠키를 지운다.

### 2.2 팀

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups` | 유저 | - | `{ data: GroupSummary[] }` — PERSONAL 먼저, 그다음 joinedAt 순 |
| POST | `/groups` | 유저 | `{ name }` | 201 `{ data: GroupDetail }`. type 은 항상 TEAM, 요청자가 첫 멤버, 초대 코드 발급 |
| GET | `/groups/:groupId` | 멤버 | - | `{ data: GroupDetail }` |
| PATCH | `/groups/:groupId` | 멤버 | `{ name }` | `{ data: GroupDetail }` |
| POST | `/groups/:groupId/invite-code` | 멤버 | - | `{ data: { inviteCode, inviteUrl } }`. 새 코드로 교체, 이전 코드 즉시 무효. PERSONAL 이면 GROUP_NOT_INVITABLE |
| GET | `/invites/:code` | 없음 | - | `{ data: { groupName, memberCount } }`. 로그인 전 미리보기 |
| POST | `/groups/join` | 유저 | `{ code }` | `{ data: GroupDetail }`. 이미 멤버면 그대로 200 (멱등). 코드 없으면 INVITE_NOT_FOUND |
| PATCH | `/groups/:groupId/me` | 멤버 | `{ color?, displayName? }` | `{ data: Member }`. displayName 에 `null` 을 보내면 닉네임으로 되돌림 |
| DELETE | `/groups/:groupId/me` | 멤버 | - | `{ data: { groupDeleted: boolean } }`. 팀 나가기 (2.7) |

```ts
GroupSummary = { id, type: 'PERSONAL'|'TEAM', name, memberCount, me: { color, displayName }, unreadNewsCount }
GroupDetail  = { id, type, name, inviteCode: string|null, inviteUrl: string|null, createdAt,
                 members: Member[], me: Member }
Member       = { userId, displayName, color, profileImageUrl, joinedAt }
```

- `inviteUrl` = `${WEB_ORIGIN}/join/${inviteCode}`
- `unreadNewsCount` = 그 팀 EventLog 중 `createdAt > me.lastSeenAt` 이고 `actorId != me` 인 건수. 팀 수만큼 count 쿼리 (사용자당 팀 수가 작아 허용)
- 초대 코드: 알파벳 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (혼동 문자 제외) 6자. 충돌 시 재생성. 입력은 대문자로 정규화
- 멤버 색: 합류 시 아래 팔레트 중 그 팀에서 가장 적게 쓰인 색을 자동 배정. 검증은 `^#[0-9A-Fa-f]{6}$` 만 (팔레트 밖 값도 허용)

```
MEMBER_COLORS = ['#F26D6D','#F2994A','#F2C94C','#6FCF97','#56CCF2','#5B6CF4','#A66CF4','#F279B5']
```

### 2.3 일정

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/events` | 멤버 | 쿼리 `from`, `to` (ISO, `to - from <= 62일`) | `{ data: Event[] }` 반복 원본은 기간 안 회차로 펼친다. `startsAt` 오름차순, 같으면 `id`, 그다음 `occurrence` |
| POST | `/groups/:groupId/events` | 멤버 | `EventInput` | 201 `{ data: Event }` (반복이면 첫 회차) + EventLog CREATED |
| GET | `/groups/:groupId/events/:eventId` | 멤버 | 쿼리 `occurrence?` | `{ data: Event & { hasLaterExceptions } }` |
| PATCH | `/groups/:groupId/events/:eventId` | 멤버 | `Partial<EventInput>`, 쿼리 `occurrence`, `scope` (반복만) | `{ data: Event }` + EventLog UPDATED. 현재 값과 합친 결과가 그대로면(빈 본문, 같은 값, 같은 순간의 다른 오프셋 표기) 저장하지 않고 로그도 남기지 않으며 `updatedAt` 그대로 200 |
| DELETE | `/groups/:groupId/events/:eventId` | 멤버 | 쿼리 `occurrence`, `scope` (반복만) | `{ data: { ok: true } }` + EventLog DELETED (삭제 전 스냅샷) |

```ts
EventInput = { title: string(1~50), startsAt: ISO, endsAt: ISO, allDay: boolean, memo?: string(≤500),
               repeat?: 'WEEKLY'|'BIWEEKLY'|'MONTHLY'|'YEARLY'|null,   // 생략/null = 한 번짜리 (#187)
               repeatUntil?: 'YYYY-MM-DD'|null }                       // KST, 그날 시작하는 회차 포함. 생략/null = 계속
Event      = { id, groupId, title, startsAt, endsAt, allDay, memo, creator: Member|탈퇴자, createdAt, updatedAt,
               repeat, repeatUntil,
               occurrence: 'YYYY-MM-DD'|null,   // 회차의 원래 날짜 (KST). 한 번짜리는 null
               seriesStartsAt: ISO|null }       // 반복이면 원본 첫 회차 시작
// 단건 GET 만: hasLaterExceptions: boolean   // 이 회차보다 뒤에 "이 일정만" 예외(취소 포함)가 있는지. 한 번짜리는 false
```

- 조회 조건은 겹침: `startsAt < to AND endsAt > from` (인덱스 `(groupId, startsAt)`). 반복 회차는 최종 시각(예외 반영) 기준으로 같은 조건
- `endsAt > startsAt` 이어야 하고 길이 30일 이하. 아니면 EVENT_RANGE_INVALID
- 종일(`allDay: true`): 클라이언트가 `startsAt` = 그날 KST 00:00, `endsAt` = 다음 날 KST 00:00 (UTC 로 변환) 을 보낸다. 서버는 그 두 값이 KST 자정인지 검증하지 않는다 (표시는 allDay 플래그만 본다)
- 팀원 누구나 수정/삭제. 등록자 제한 없음
- 단건(GET/PATCH/DELETE)의 `eventId` 는 `groupId` 안에서만 찾는다. 멤버가 아니면 403 FORBIDDEN, 멤버이지만 다른 팀 소속 일정이면 없는 ID 와 똑같이 404 NOT_FOUND (존재 여부 비노출. 결정기록 D-31)

#### 반복 일정 (#187, D-63 ~ D-67)

설계 근거는 `반복-일정.md`. 회차는 저장하지 않고 서버가 조회 기간만 펼친다 (`apps/api/src/events/recurrence.ts`).

- 회차의 주소는 `(id, occurrence)`. 화면 키는 `${id}:${occurrence ?? ''}`. 회차 날짜는 원래 날짜라 "이 일정만" 으로 옮겨도 바뀌지 않는다
- 회차 날짜: 첫 회차 KST 날짜 기준 매주 +7일, 격주 +14일, 매월 같은 날(없는 달은 말일), 매년 같은 월일(2/29 는 평년 2/28). 시각은 원본의 KST 벽시계 시각, 길이는 원본 길이
- `occurrence`, `scope` 쿼리는 **한 번짜리 일정이면 무시**한다 (값이 틀려도 지금과 같다)
- 반복 일정의 단건 GET: `occurrence` 가 없거나 빈 값이면 첫 회차. PATCH/DELETE 는 `scope` 가 없거나 `this`/`following` 이 아니면 400 VALIDATION_FAILED (`details[0].field = 'scope'`), `occurrence` 가 없거나 `YYYY-MM-DD` 실제 날짜가 아니면 400 (`field: 'occurrence'`)
- `occurrence` 가 규칙상 회차 날짜가 아니거나, `repeatUntil` 뒤, 또는 취소된 회차면 404 NOT_FOUND

| 동작 | 처리 (트랜잭션 1개) | 응답 | 로그 |
|------|------|------|------|
| PATCH this | `EventException(eventId, occurrence)` upsert. 원래 회차와 다른 필드만 저장, 모두 원래 값이 되면 예외 행 삭제. 본문에 `repeat`/`repeatUntil` 이 있으면 400 VALIDATION_FAILED | 그 회차 | UPDATED, scope THIS |
| PATCH following, 첫 회차 | 원본 수정 + 원본의 예외 전부 삭제 | 수정된 첫 회차 (반복을 끄면 한 번짜리) | UPDATED, scope FOLLOWING |
| PATCH following, 그 뒤 회차 | 원본 `repeatUntil = occurrence - 1일`, `occurrence` 이후(그날 포함) 예외 삭제, 새 Event 생성 (`creatorId` = 원본 등록자) | 새 원본의 첫 회차 | UPDATED, scope FOLLOWING, `eventId` = 새 원본 |
| DELETE this | 예외 upsert `cancelled = true` | `{ ok: true }` | DELETED, scope THIS |
| DELETE following, 첫 회차 | 원본 삭제 (예외 cascade) | `{ ok: true }` | DELETED, scope FOLLOWING (`eventId` 는 SetNull 로 null) |
| DELETE following, 그 뒤 회차 | 원본 `repeatUntil = occurrence - 1일`, 이후 예외 삭제 | `{ ok: true }` | DELETED, scope FOLLOWING |

- PATCH 의 기준 값은 **그 회차의 현재 값**(예외 반영) + 본문. "이후 모두" 에서 `repeat` 생략은 그대로, `null` 은 반복 끄기(`repeatUntil` 도 null). `repeatUntil` 생략은 그대로
- "이후 모두" 로 시작 시각/날짜를 바꾸면 새 원본의 첫 회차가 되어 요일, 날짜 기준도 따라 바뀐다
- 메모를 지운 "이 일정만" 예외는 `memo = ''` 로 저장한다 (null 은 원본 값. D-65). 응답 `memo` 도 `''`
- 같은 값이면 저장하지 않는 규칙(#62): this 는 회차의 현재 값과 같으면 no-op. following 첫 회차는 원본 값, 규칙이 같고 예외가 없으면 no-op. following 그 뒤 회차는 원래 회차 값, 규칙이 같고 그 회차부터 예외가 없으면 no-op (나눠도 결과가 같다)
- 한 번짜리 일정을 PATCH 해 `repeat` 을 켜면 그 일정이 첫 회차가 된다 (scope 불필요)

검증 (설계 4-1):

| 조건 | 오류 | message |
|------|------|---------|
| 길이 >= 주기 (WEEKLY 7일, BIWEEKLY 14일, MONTHLY 28일, YEARLY 365일) | EVENT_RANGE_INVALID | 반복 간격보다 긴 일정은 반복할 수 없어요 |
| `repeatUntil` < 첫 회차 KST 날짜 | EVENT_RANGE_INVALID | 종료 날짜는 시작 날짜 뒤여야 해요 |
| `repeatUntil` 만 있고 `repeat` 없음 | VALIDATION_FAILED (`field: 'repeatUntil'`) | 반복 주기 없이 종료 날짜만 정할 수 없어요 |
| this 예외: 시작 < 원래 날짜 00:00 - 30일, 또는 끝 > 다음 날 00:00 + 30일 (KST) | EVENT_RANGE_INVALID | 이 회차는 앞뒤 30일 안으로만 옮길 수 있어요 |
| `repeat` 이 넷 중 하나가 아님, `repeatUntil` 이 실제 날짜가 아님 | VALIDATION_FAILED | DTO 문구 |
| 기존 규칙 (종료 > 시작, 30일 이하) | 그대로 (먼저 검사) | 그대로 |

### 2.4 기념일

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/anniversaries` | 멤버 | - | `{ data: Anniversary[] }` date 오름차순 |
| POST | `/groups/:groupId/anniversaries` | 멤버 | `{ name(1~30), date: 'YYYY-MM-DD', kind? }` (kind 생략 시 `COUNT_UP`) | 201 `{ data: Anniversary }` |
| PATCH | `/groups/:groupId/anniversaries/:anniversaryId` | 멤버 | `{ name?, date?, kind? }` | `{ data: Anniversary }` |
| DELETE | `/groups/:groupId/anniversaries/:anniversaryId` | 멤버 | - | `{ data: { ok: true } }` |

```ts
Anniversary = { id, groupId, name, date: 'YYYY-MM-DD', kind: AnniversaryKind, creator: Member|탈퇴자, createdAt }
AnniversaryKind = 'COUNT_UP' | 'YEARLY' | 'ONCE'   // 함께한 날 세기(기본) / 매년 반복 / 그날만
```

D-day / D+N / 100일 단위 계산은 클라이언트 (화면흐름.md 7번).

기념일 종류 `kind` (#105, #106, D-62): 서버는 저장만 하고 응답(GET 목록, POST, PATCH)에 그대로 싣는다. 셋 외의 값과 `null` 은 400 VALIDATION_FAILED (`details[0].field = 'kind'`). 종류 도입 전 행은 `COUNT_UP`. 100일 단위, N주년, 매년 항목 계산은 클라이언트 (D-60). 규칙은 `docs/기획/기념일-자동표시.md`

### 2.5 빈 시간 찾기

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/free-slots` | 멤버 | 쿼리 아래 | `{ data: { slots: { startsAt, endsAt }[], memberCount } }` |

| 쿼리 | 기본 | 제약 |
|------|------|------|
| `from`, `to` | 필수 | ISO. `to - from <= 31일`, `from` 이 과거면 현재 시각을 **다음 30분 경계로 올려** 잘라서 계산 (14:37 → 15:00, 14:00 은 그대로. 결정기록 D-30) |
| `dayStart`, `dayEnd` | `09:00`, `23:00` | `HH:mm` KST. `dayStart` 는 `00:00`~`23:59`, `dayEnd` 는 `00:00`~`24:00` (`24:00` 은 그날 자정 끝 = 다음 날 00:00). `dayStart < dayEnd` |
| `minMinutes` | `120` | 30~720 |
| `includeAllDay` | `false` | `true` 면 종일 일정도 바쁨으로 센다 |

쿼리 전략 (요청 1건에 DB 조회 4번, 일정 내용은 조회하지 않음):

```
1. 멤버십 확인 → 요청 팀의 memberIds = Membership.findMany({ groupId }).userId
2. allGroupIds = Membership.findMany({ userId in memberIds }).groupId (distinct)
   → 멤버들이 속한 모든 팀 (개인 팀 포함). 같은 팀이 여러 멤버에 걸려도 한 번만
3. once = Event.findMany({
     where: { groupId in allGroupIds, repeat: null, startsAt < to, endsAt > from, ...(includeAllDay ? {} : { allDay: false }) },
     select: { startsAt, endsAt },          // title/memo 는 select 하지 않는다 (타 팀 내용 비노출)
     orderBy: { startsAt: 'asc' } })
   series = Event.findMany({               // 반복 원본 (#187, 반복-일정.md 4-2)
     where: { groupId in allGroupIds, repeat != null, startsAt < to + 31일,
              OR: [{ repeatUntil: null }, { repeatUntil >= (from - 31일) 의 KST 날짜 }] },
     select: { startsAt, endsAt, allDay, repeat, repeatUntil,
               exceptions: { occurrence, cancelled, startsAt, endsAt, allDay } } })   // 여기도 title/memo 없음
   → series 를 [from, to) 회차로 펼치고(취소 제외, 예외 시각 반영) includeAllDay 가 아니면 최종 allDay 회차를 뺀다
   → busy = once + 회차, startsAt 오름차순
4. busy 를 정렬 상태에서 한 번 훑어 겹치거나 맞닿은 구간을 병합
5. [from, to) 를 KST 날짜별로 나눠 각 날의 [dayStart, dayEnd) 창을 만들고, 병합된 busy 를 빼서 남은 조각 중
   길이 >= minMinutes 인 것만 slots 에 담는다. 창은 고정 +09:00 으로 계산 (DST 없음)
6. slots 는 startsAt 오름차순, 최대 100개 (초과분은 잘라냄)
```

- 응답에는 비는 구간만 있다. 누가 왜 바쁜지는 어떤 형태로도 내려주지 않는다
- 종일 일정은 기본 제외, `includeAllDay=true` 일 때만 바쁨으로 센다 (결정기록 D-12)

### 2.6 새 소식

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/news` | 멤버 | - | `{ data: { items: NewsItem[], lastSeenAt } }` |
| POST | `/groups/:groupId/news/seen` | 멤버 | - | `{ data: { lastSeenAt } }`. `Membership.lastSeenAt = now` |

```ts
NewsItem = { id, action: 'CREATED'|'UPDATED'|'DELETED', eventId: string|null,
             title, startsAt, endsAt, allDay,
             repeat: 'WEEKLY'|'BIWEEKLY'|'MONTHLY'|'YEARLY'|null,   // 변경 시점의 반복 주기 (#187)
             scope: 'THIS'|'FOLLOWING'|null,                         // 반복 일정에서 고른 범위. 한 번짜리, 새 반복 추가는 null
             occurrence: 'YYYY-MM-DD'|null,                          // 범위를 고른 회차 날짜 (KST)
             actor: Member|탈퇴자, createdAt, isNew: boolean }
```

- 반복 일정 동작 하나는 로그 1건. `title`, `startsAt`, `endsAt`, `allDay` 스냅샷은 그 회차 값 ("이후 모두" 수정은 새 원본의 첫 회차). 문구는 웹이 `action` + `scope` + `repeat` + `occurrence` 로 조합 (반복-일정.md 4-3)
- 반복 일정 항목을 누르면 `/events/:eventId?occurrence=` 로 이동

- items = 그 팀 EventLog 중 `actorId != 요청자` (탈퇴자 null 포함), 최근 30일, createdAt 내림차순, 최대 50건
- `isNew` = `createdAt > me.lastSeenAt`. 화면은 목록을 받은 뒤 `seen` 을 호출한다 (순서 고정: GET → POST)
- `eventId` 가 null 이거나 action 이 DELETED 면 탭해도 일정으로 이동하지 않는다

### 2.7 나가기 / 탈퇴 처리 순서

**DELETE /groups/:groupId/me (팀 나가기)** — 한 트랜잭션

```
1. 멤버십 확인. group.type == PERSONAL 이면 GROUP_PERSONAL_LEAVE
2. 멤버십 삭제. 일정/기념일/로그는 그대로 (creatorId, actorId 유지 → 여전히 그 사람 이름으로 보임)
3. 남은 멤버 0 이면 Group 삭제 (Cascade 로 일정/기념일/로그/멤버십 전부) → groupDeleted: true
```

**DELETE /me (회원 탈퇴)**

```
1. 카카오 unlink: POST https://kapi.kakao.com/v1/user/unlink
   Authorization: KakaoAK ${KAKAO_ADMIN_KEY}, body target_id_type=user_id&target_id=<AuthAccount.providerUserId>
   실패(이미 끊긴 경우 제외) → 502 KAKAO_ERROR, DB 는 건드리지 않음 (사용자가 다시 시도)
   애플 계정이면 Apple /auth/revoke (앱.md 3.5). 실패 → 502 APPLE_ERROR, DB 그대로
2. 트랜잭션:
   a. 내 PERSONAL 팀 삭제 (Cascade)
   b. 내 TEAM 멤버십 각각에 대해 2.7 나가기 2~3 단계 (마지막 멤버였던 팀은 삭제)
   c. User 삭제 → 남은 Event.creatorId / Anniversary.creatorId / EventLog.actorId 는 FK SetNull → "탈퇴한 멤버"
3. 웹은 응답을 받으면 쿠키를 지우고 /login 으로
```

## 3. 기획 기능 → API 추적

| 기획 기능 | 엔드포인트 |
|-----------|-----------|
| 카카오 로그인 | `/auth/kakao`, `/auth/kakao/callback`, `/me` |
| 앱 로그인 (카카오, 애플), 웹 애플 로그인 | `/auth/kakao/native`, `/auth/apple/native`, `/auth/apple`, `/auth/apple/callback`, `/auth/handoff` (앱.md) |
| 닉네임/프로필 사진 변경 | `PATCH /me`, `POST /me/avatar`, `DELETE /me/avatar` |
| 팀 만들기, personal 자동 생성 | `POST /groups`, 콜백의 User upsert 시 PERSONAL 생성 (인증흐름.md) |
| 초대 링크 + 6자리 코드, 재발급 | `GroupDetail.inviteCode/inviteUrl`, `POST /groups/:id/invite-code`, `GET /invites/:code`, `POST /groups/join` |
| 팀 전환 | `GET /groups` |
| 월 달력 + 일 목록 | `GET /groups/:id/events?from&to` |
| 일정 CRUD | 2.3 전부 |
| 기념일 D-day | 2.4 전부 |
| 빈 시간 찾기 | `GET /groups/:id/free-slots` → `POST /groups/:id/events` |
| 새 소식 + 배지 | 2.6, `GroupSummary.unreadNewsCount` |
| 멤버 색/닉네임 | `PATCH /groups/:id/me` |
| 팀 나가기 / 삭제 | `DELETE /groups/:id/me` |
| 회원 탈퇴 | `DELETE /me` |

## 4. 개발 전용

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| POST | `/auth/dev-login` | 없음 | `{ nickname(1~50) }` | `{ data: { token, user } }`. 카카오 없이 테스트 사용자를 만들고(같은 닉네임이면 재사용) JWT 를 발급. **`NODE_ENV !== 'production'` 에서만** 존재하고 운영에서는 404 NOT_FOUND (결정기록 D-29) |

- `KAKAO_CLIENT_ID` 가 비어 있어도 서버는 기동한다. 카카오가 필요한 엔드포인트(`/auth/kakao`, 실사용자 `DELETE /me` 의 unlink)만 503 `KAKAO_NOT_CONFIGURED` 를 돌려준다
