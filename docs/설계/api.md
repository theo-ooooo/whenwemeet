# API 명세

- 이슈: #2
- prefix `/v1`. 브라우저는 웹의 `/api/<path>` 프록시로만 호출 (프록시가 `/v1/<path>` 로 전달, 인증흐름.md)

## 1. 공통

| 항목 | 규칙 |
|------|------|
| 응답 봉투 | 모든 응답은 `{ status: number, data: any, message: string, error?: any }`. `status` 는 HTTP 상태 코드와 항상 같은 값. **예외**: (#193) 공개 구독 피드 `GET /ics/:token.ics` 는 외부 캘린더가 읽는 파일이라 `text/calendar` 본문 그대로, 실패는 본문 없는 상태 코드 (2.12, D-220) |
| 성공 | `200 { status: 200, data, message: "OK" }`. 생성은 201. 삭제는 `data: { ok: true }`. 이 문서의 엔드포인트 표에 적힌 `{ data: ... }` 는 `data` 필드의 모양이다 |
| 실패 | `{ status, data: null, message, error: { code, details? } }`. code 는 아래 오류 표, message 는 사용자에게 바로 보여도 되는 한국어 한 문장. `details` 는 검증 실패 시 필드별 위반 목록(`[{ field, message }]`), 이메일 로그인 오류는 이유 객체(`{ reason, retryAfterSec }` 등, 2.1 이메일 로그인) |
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
| GROUP_NOT_INVITABLE | 400 | PERSONAL 팀에 초대 코드 재발급 요청, (#274) PERSONAL 팀 일정 공유 링크 만들기 |
| EVENT_SHARE_ENDED | 400 | (#274) 이미 끝난 일정(회차)의 공유 링크 만들기 |
| TODO_LIMIT_REACHED | 400 | (#276) 할 일 목록 20개/팀, 항목 300개/목록을 넘김. message "목록은 20개까지 만들 수 있어요" / "항목은 300개까지 넣을 수 있어요" |
| GROUP_PERSONAL_LEAVE | 400 | PERSONAL 팀 나가기 시도 (탈퇴로만 삭제됨) |
| UNAUTHORIZED | 401 | 토큰 없음, 서명 불일치, 만료, sub 사용자 없음(탈퇴) |
| FORBIDDEN | 403 | 해당 팀 멤버가 아님 |
| GROUP_HIDDEN | 403 | (#515) 관리자가 숨긴 팀의 팀 경로(멤버십 확인을 거치는 모든 곳, 공개 코드 조회 포함). `details: { reason }`(숨긴 사유). 팀 나가기 `DELETE /groups/:id/me` 만 통과. message "운영 정책 위반으로 이용이 제한된 팀이에요" (D-286) |
| NOT_PARTICIPANT | 403 | (#190) 그 회차의 참여자가 아닌데 참석 여부를 보냄. message "이 일정의 참여자만 응답할 수 있어요". (#189) 약속 투표 대상이 아닌데 표를 보냄. message "이 투표의 대상이 아니에요" |
| POLL_CLOSED | 409 | (#189) 정한 투표에 표, 정하기, 취소 ("이미 정해진 투표예요"), 마감 지난 투표에 표 ("투표가 끝났어요") |
| EVENT_RESTORE_CONFLICT | 409 | (#375) 삭제를 되돌리려는데 그 사이 일정이 바뀌었다 ("그 사이 일정이 바뀌어서 되돌리지 못했어요", D-251) |
| LINK_TICKET_INVALID | 400 | (#198) 로그인 방법 연결 티켓이 없음, 만료(5분), 사용됨, 다른 사용자가 시작함 (구분하지 않는다). 연결 시작 표식이 틀려도 웹 `/me/link?error=LINK_TICKET_INVALID` |
| REAUTH_REQUIRED | 409 | (#198) 로그인 방법 연결 시작, 연결, 이메일 연결 메일 요청인데 세션 JWT `iat` 가 10분을 넘음 ("보안을 위해 다시 로그인해 주세요", D-257) |
| PROVIDER_ALREADY_LINKED | 409 | (#198) 같은 제공자를 이미 연결함 (한 제공자당 하나) |
| AUTH_ACCOUNT_IN_USE | 409 | (#198) 연결하려는 로그인이 다른 계정에 있고 그 계정이 비어 있지 않음 (D-257 판정) |
| LAST_AUTH_ACCOUNT | 409 | (#198) 마지막 로그인 방법 해제 |
| POLL_OPTION_PAST | 400 | (#189) 시작이 지난 후보를 새로 켜거나 정함. message "이미 지난 시간이에요" |
| NOT_FOUND | 404 | 팀/일정/기념일/할 일 목록, 항목 없음 (다른 팀 자원을 가리키는 ID 포함) |
| INVITE_NOT_FOUND | 404 | 초대 코드 없음 |
| EVENT_SHARE_NOT_FOUND | 404 | (#274) 일정 공유 링크 없음, 만료, 끊김, 일정 삭제, 회차 취소, 회차 소멸 (구분하지 않는다). message "링크가 만료됐거나 끊겼어요" |
| PAYLOAD_TOO_LARGE | 413 | JSON 본문이 100KB 초과 (express 기본 한도). message "요청 내용이 너무 커요". 아바타 파일 크기 초과는 해당 없음(400 VALIDATION_FAILED) |
| SOCIAL_TOKEN_INVALID | 401 | 앱 로그인의 카카오/애플 토큰 검증 실패 (앱.md 8장) |
| HANDOFF_INVALID | 401 | handoff 없음, 만료, 사용됨, verifier 불일치 (앱.md 2장) |
| APPLE_ERROR | 502 | 애플 JWKS, 토큰 교환, 폐기 실패 |
| APPLE_NOT_CONFIGURED | 503 | `APPLE_*` 미설정 |
| KAKAO_ERROR | 502 | 카카오 토큰 교환/사용자 조회/unlink 실패 |
| STORAGE_NOT_CONFIGURED | 503 | R2 환경변수 미설정 상태에서 아바타 업로드/삭제 |
| KAKAO_NOT_CONFIGURED | 503 | 카카오 환경변수 미설정 상태에서 로그인 (D-29) |
| DB_UNAVAILABLE | 503 | `GET /health` 의 DB 확인(`SELECT 1`) 실패. 배포 healthcheck 가 이 응답이면 트래픽을 넘기지 않는다 (#50) |
| PLACE_SEARCH_FAILED | 502 | (#199) 카카오 장소 검색 실패 (2.14) |
| PLACE_SEARCH_NOT_CONFIGURED | 503 | (#199) 운영에 그 출처의 키(카카오 `KAKAO_REST_API_KEY`, 네이버 `NAVER_SEARCH_CLIENT_ID`/`SECRET`, D-259)가 없음. 웹은 장소를 직접 적게 둔다 (2.14) |
| EMAIL_RATE_LIMITED | 429 | 이메일 로그인 발송 횟수 제한. `details: { reason: "COOLDOWN" \| "HOURLY" \| "IP", retryAfterSec }` (#245) |
| RATE_LIMITED | 429 | 요청 제한 초과 (#186, 아래 "요청 제한"). message "잠시 후 다시 시도해 주세요", `details: { retryAfterSec }`, 헤더 `Retry-After: <초>` |
| EMAIL_LINK_INVALID | 400 | 로그인 링크 없음, 사용됨, 만료, 무효. `details: { reason: "INVALID" \| "USED" \| "EXPIRED" }` |
| EMAIL_CODE_INVALID | 400 | 코드 불일치. `details: { attemptsLeft }` |
| EMAIL_CODE_LOCKED | 400 | 코드 5번째 틀림. 그 메일(링크 포함)은 무효 |
| EMAIL_CODE_EXPIRED | 400 | 그 이메일의 살아 있는 메일 없음 (만료, 사용, 새로 받음, 잠김) |
| SIGNUP_TOKEN_INVALID | 401 | 이메일 가입 티켓 없음, 만료(30분), 사용됨 |
| EMAIL_NOT_CONFIGURED | 503 | `EMAIL_LOGIN_ENABLED` 꺼짐, 운영에서 `RESEND_API_KEY` 또는 `INTERNAL_API_KEY` 없음 |
| IMPORT_TOO_LARGE | 400 | (#279) ICS 파일의 VEVENT 가 3,000개 초과 |
| IMPORT_INCOMPLETE | 500 | (#279) 일정 가져오기가 중간에 실패. 넣은 묶음은 남는다. message "N개 중 M개 넣었어요. 같은 파일을 다시 올리면 나머지만 들어가요", `details: { created, total }`. 웹은 점검 화면으로 보내지 않는다(INTERNAL 아님) |
| ASSISTANT_CONSENT_REQUIRED | 409 | (#450) AI 비서 처음 안내에 동의하기 전 메시지. message "먼저 안내를 확인해 주세요" (2.15) |
| NOTICE_ALREADY_PUSHED | 409 | (#528) 이미 푸시를 보낸 공지에 다시 `push: true`. message "이 공지는 이미 푸시로 보냈어요" (2.16, D-287) |
| ASSISTANT_DAILY_LIMIT | 429 | (#450) AI 비서 하루 30번(KST) 초과. `details: { limit, resetAt }`, `Retry-After` 없음 (2.15, D-269) |
| ASSISTANT_UNAVAILABLE | 503 | (#450) `OPENAI_API_KEY` 없음, OpenAI 인증 실패, 잔액, 한도, 5xx, 연결 실패 (2.15) |
| ASSISTANT_TIMEOUT | 504 | (#450) OpenAI 호출 10초 초과. message "답이 늦어지고 있어요. 다시 보내 주세요" (2.15) |
| INTERNAL | 500 | 그 외. message 는 "잠시 후 다시 시도해 주세요" 고정 |

### 요청 제한 (#186, D-143)

API 프로세스 메모리의 고정 창(fixed window) 카운터. API 는 한 인스턴스라 공유 저장소가 없고, 재시작하면 0 부터 센다. 넘으면 429 `RATE_LIMITED` (`details: { retryAfterSec }`, `Retry-After` 헤더). 거절된 요청은 세지 않는다.

| 대상 | 기준 | 한도 |
|------|------|------|
| 로그인: `GET /auth/kakao`, `GET /auth/kakao/callback`, `POST /auth/kakao/native`, `GET /auth/apple`, `POST /auth/apple/callback`, `POST /auth/apple/native`, `POST /auth/handoff` | IP (경로끼리 한 묶음) | 20 / 1분 |
| 초대 미리보기 `GET /invites/:code` | IP | 30 / 1분 |
| 초대 합류 `POST /groups/join` (6자리 코드 추측 방지) | 사용자 **그리고** IP | 사용자 10 / 10분, IP 30 / 10분 |
| 일정 링크 미리보기 `GET /event-shares/:token` (#274) | IP | 30 / 1분 (초대 미리보기와 다른 묶음) |
| 일정 링크 합류 `POST /event-shares/:token/join` (#274) | 사용자 **그리고** IP | 초대 합류 `POST /groups/join` 과 **같은 묶음** (두 길을 번갈아 써서 한도를 두 배로 받지 못하게) |
| 일정 링크 만들기 `POST /groups/:id/events/:eventId/share` (#274) | 사용자 | 30 / 1시간 |
| 구독 피드 `GET /ics/:token.ics` (#193) | 주소(경로 토큰) **그리고** IP | 주소 10 / 1분, IP 60 / 1분. 넘으면 본문 없는 429 + `Retry-After` |
| 장소 검색 `GET /places/search` (#199, 카카오와 네이버가 같은 묶음 D-259) | 사용자 | 60 / 1분 |
| 장소 다시 찾기 `GET /places/resolve` (#199) | 사용자 | 120 / 1분 |
| 사진 업로드 `POST /me/avatar` | 사용자 | 20 / 1시간 |
| 일정 가져오기 미리보기 `POST /groups/:id/imports/preview` (#279) | 사용자 | 30 / 1시간 |
| 일정 가져오기 `POST /groups/:id/imports` (#279) | 사용자 | 10 / 1시간 |
| AI 비서 `POST /groups/:id/assistant/messages` (#450) | 사용자 | 10 / 1분 (하루 30번은 DB 로 따로 센다, 2.15) |
| 그 밖의 모든 요청 (위 경로도 함께 센다) | 로그인(유효한 JWT)이면 사용자, 아니면 IP | 사용자 300 / 1분, IP 600 / 1분 |

- 제외: `GET /health` (배포 healthcheck, 점검 화면). 푸시 스케줄러는 HTTP 가 아니라 대상 아님. 이메일 엔드포인트는 자체 제한(EMAIL_RATE_LIMITED)을 그대로 두고 기본 한도만 함께 센다
- 사용자 기준은 가드가 JWT 서명을 직접 확인한 `sub`. 서명이 틀린 토큰은 IP 로 센다 (남의 sub 를 위조해 그 사람 한도를 소진시키지 못하게)
- 인증 가드보다 먼저 돈다. 토큰 없는 요청, 401 이 될 요청도 IP 기본 한도에 들어간다
- 브라우저가 직접 여는 로그인 경로(`GET /auth/kakao`, `GET /auth/kakao/callback`, `GET /auth/apple`, `POST /auth/apple/callback`)는 JSON 대신 `302 → {WEB_ORIGIN}/login?error=RATE_LIMITED` (헤더 `Retry-After` 동일)

**IP 판정**
1. 요청의 `X-Internal-Key` 가 `INTERNAL_API_KEY` 와 같으면(상수 시간 비교) 웹 서버가 보낸 요청이다. `X-Client-IP`(100자 이하) 를 IP 로 쓴다. 헤더가 없으면 `internal` 한 묶음 (OG 이미지처럼 사용자 요청이 아닌 웹 서버 자신의 호출)
2. 키가 없거나 다르면(앱의 네이티브 로그인, 브라우저의 카카오/애플 리다이렉트처럼 API 를 직접 부르는 요청) Railway 엣지가 넣는 `X-Real-IP`. 그것도 없으면(로컬, 테스트) 소켓 주소
3. `X-Forwarded-For` 는 쓰지 않는다. Railway 문서가 클라이언트 IP 헤더로 `X-Real-IP` 만 명시하고, XFF 를 덮어쓰는지 이어 붙이는지 밝히지 않아 위조 여부를 장담할 수 없다

웹 프록시(`/api/[...path]`, 서버 컴포넌트 `serverApi`, `/auth/app` handoff 교환, 로그아웃 기기 해제)는 모든 API 호출에 `X-Internal-Key` 와 사용자 IP(`X-Client-IP` = Vercel 의 `X-Forwarded-For` 첫 값)를 싣는다. 웹은 429 의 `Retry-After` 를 그대로 브라우저에 넘기고, 화면은 RATE_LIMITED 면 "잠시 후 다시 시도해 주세요" 를 보여준다. `/auth/app` 이 429 를 받으면 `/login?error=RATE_LIMITED`.

**운영 주의**: Railway(api)와 Vercel(web)의 `INTERNAL_API_KEY` 가 다르거나 한쪽이 비면 웹 경유 요청이 모두 Vercel 의 나가는 IP 몇 개로 묶여 기본 IP 한도(600/1분)를 사용자 전체가 나눠 쓰게 된다. 키를 바꿀 때는 두 곳을 같이 바꾼다.

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
| `EMAIL_LOGIN_ENABLED`, `RESEND_API_KEY`, `EMAIL_FROM`, `INTERNAL_API_KEY`, `REVIEW_EMAIL`, `REVIEW_CODE`, `RESEND_API_URL` | 이메일 로그인 (#245, 이메일-로그인.md 4-4). 모두 운영 기동 필수 아님. 스위치가 `1` 이 아니거나 운영에서 Resend 키나 내부 키가 없으면 이메일 엔드포인트만 503. 코드, IP 해시 키는 `JWT_SECRET` 에서 HKDF 로 파생 |
| `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN`, `EXPO_PUSH_URL` | 푸시 (#188, 2.8). 모두 선택. `PUSH_ENABLED=1` 일 때만 30초 틱이 돈다 (기본 끔) |
| `KAKAO_REST_API_KEY`, `PLACE_SEARCH_FAKE` | (#199) 장소 검색 프록시(2.14). 지도 전용 카카오 앱("언제볼까 장소 검색" REST 키, 로그인 `KAKAO_CLIENT_ID` 와 다른 앱). 선택. 없으면 운영은 장소 검색만 503, 로컬은 가짜 목록. `PLACE_SEARCH_FAKE=1` 은 카카오, 네이버 둘 다 가짜 |
| `NAVER_SEARCH_CLIENT_ID`, `NAVER_SEARCH_CLIENT_SECRET`, `NAVER_SEARCH_URL` | (D-259) 네이버 장소 검색(2.14). NAVER API HUB 지역 검색 키 둘(비밀). 선택. 하나라도 없으면 운영은 `provider=naver` 만 503, 로컬은 가짜 목록. `NAVER_SEARCH_URL` 은 테스트용 주소 바꾸기(기본 `https://naverapihub.apigw.ntruss.com/search/v1/local`) |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `ASSISTANT_FAKE` | (#450) AI 비서(2.15). 모두 선택. 키가 없으면 `/me.assistant.available = false`, 메시지 503. `OPENAI_MODEL` 기본 `gpt-4.1-mini`(D-278). `ASSISTANT_FAKE=1` 은 키 없이 가짜 모델(운영에서는 무시) |
| `API_PUBLIC_ORIGIN` | (#193) 구독 주소의 API 공개 주소. 선택. 없으면 운영(`NODE_ENV=production`) `https://api.whenwemeet.day`, 그 밖 `http://localhost:${PORT}` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | Cloudflare R2 (S3 호환). `R2_PUBLIC_BASE_URL` 은 공개 도메인(`https://images.whenwemeet.day`). 응답의 사진 URL 은 이 값 + `File.key` 로 매번 만들므로 도메인을 바꾸면 기존 사진 URL 도 바로 바뀐다 (D-56). docs/운영/cloudflare-r2.md |

## 2. 엔드포인트

### 2.1 인증

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/health` | 없음 | - | `{ data: { ok: true } }`. DB 에 `SELECT 1` 을 보내 실패하면 503 DB_UNAVAILABLE |
| GET | `/auth/kakao` | 없음 | 쿼리 `next?` (같은 출처 상대 경로 + 쿼리, 예 `/join/ABC123?auto=1`. 규칙은 인증흐름.md 2단계, 어긋나면 `/`. 기본 `/`). (#198) `mode=link&intent=` 면 로그인 방법 연결(아래 "로그인 방법") | 302 → kauth 인가 페이지 |
| GET | `/auth/kakao/callback` | 없음 | 쿼리 `code`, `state` | 302 → `${WEB_ORIGIN}/auth/callback?token=<JWT>&next=<경로+쿼리, URL 인코딩>`. 실패 시 302 → `${WEB_ORIGIN}/login?error=<code>` |
| POST | `/auth/kakao/native` | 없음 | `{ accessToken, codeChallenge }` | `{ data: { handoff, expiresIn } }`. 앱 전용, 앱.md 3.1 |
| POST | `/auth/apple/native` | 없음 | `{ identityToken, authorizationCode, nonce, nickname?, codeChallenge }` | `{ data: { handoff, expiresIn } }`. iOS 앱 전용, 앱.md 3.3 |
| GET | `/auth/apple` | 없음 | 쿼리 `next?` | 302 → Apple 인가 (앱.md 3.4). 웹 전용 |
| POST | `/auth/apple/callback` | 없음 | form_post `code`, `state`, `id_token`, `user?` | 302 → 웹 `/auth/callback?token=` (앱.md 3.4) |
| POST | `/auth/handoff` | 없음 | `{ handoff, verifier }` | `{ data: { token } }`. 웹 서버만 호출, 앱.md 2.2. 성공 시 `User.lastAppLoginAt = now` (#188, D-97. 응답 그대로) |
| GET | `/me` | 유저 | - | `{ data: { id, nickname, profileImageUrl, createdAt, startCalendar, birthday } }`. `startCalendar` 는 처음 여는 달력 (#300, 아래 StartCalendar), `birthday` 는 내 생일 (#305, 2.4 BirthdaySettings). (#450) `assistant: { available, consented, dailyLimit, usedToday }` AI 비서 (2.15). (#515) `role: 'user'\|'admin'`, `isAdmin`, `hasUnreadNotice` (2.16) |
| PATCH | `/me` | 유저 | `{ nickname }` (1~20자, 공백만 불가) | `{ data: { id, nickname, profileImageUrl, createdAt } }`. 닉네임은 우리 서비스 값이며 소셜 프로필과 독립 |
| POST | `/me/avatar` | 유저 | `multipart/form-data` 필드 `file` (jpeg/png/webp/heic, 10MB 이하) | `{ data: { profileImageUrl } }`. 서버가 512×512 로 리사이즈해 webp 로 R2 에 저장하고 `File(kind: AVATAR)` 행 생성, `User.avatarFileId` 교체, 이전 File 행과 객체는 삭제. 응답의 `profileImageUrl` 은 `R2_PUBLIC_BASE_URL` + `File.key` (DB 에 도메인을 저장하지 않음, 결정기록 D-56) |
| DELETE | `/me/avatar` | 유저 | - | `{ data: { profileImageUrl: null } }`. File 행과 R2 객체 삭제 후 기본 아바타(이니셜) |
| PATCH | `/me/start-calendar` | 유저 | `{ mode: 'LAST'\|'PERSONAL'\|'GROUP', groupId?: number \| null }` | `{ data: StartCalendar }`. (#300, D-191) 짝: GROUP 이면 `groupId` 필수, LAST 와 PERSONAL 은 `groupId` 없음 또는 null. 짝이 틀리거나 `mode` 가 셋 밖이면 400 VALIDATION_FAILED (`field: 'groupId'`). GROUP 인데 내 팀이 아니면(없는 팀 포함) 403 FORBIDDEN. 개인 팀을 GROUP 으로 고르면 400 VALIDATION_FAILED ("내 달력" 은 PERSONAL) |
| PATCH | `/me/birthday` | 유저 | `{ date: 'MM-DD' \| null, reminders? }` | `{ data: BirthdaySettings }`. (#305, D-230, D-232) `date` 는 필수 키, 월일만(2월 29일 허용), `null` 은 지우기. 형식이 틀리거나 없는 날(02-30), 키 없음은 400 VALIDATION_FAILED (`field: 'date'`). `reminders` 는 기념일과 같은 검사, 생략은 그대로(처음 `['DAY_OF']`) |
| DELETE | `/me` | 유저 | - | `{ data: { ok: true } }`. 회원 탈퇴 (2.7). `File(ownerId = me)` 전부 객체 삭제 후 행 삭제. (#198) 내가 요청한 이메일 연결 메일 행도 지운다 |

**로그인 방법 (#198, D-257)** — 카카오, Apple, 이메일을 한 사용자에 연결하고 해제한다. 연결은 **세션(최근 로그인, JWT `iat` 10분 이내) + 두 번째 로그인의 소유 증명** 둘 다로만 한다. 자동 병합(같은 이메일) 없음. POST 응답은 `Cache-Control: no-store`, 요청 제한 `login`

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/me/auth-accounts` | 유저 | - | `{ data: AuthAccountView[] }` 카카오, Apple, 이메일 순 |
| POST | `/me/auth-accounts/link-start` | 유저 + 최근 로그인 | `{ provider: 'KAKAO' \| 'APPLE' }` | `{ data: { intent, expiresIn: 600 } }`. 웹 OAuth 연결 시작 표식(시작한 사용자 id 를 JWT_SECRET 로 서명, `typ: wwm-link-intent`, sub 없음이라 세션으로 쓰이지 않음, 10분). 웹 `/me/link/start` route handler 가 부르고, 앱 안 연결(D-282)은 네이티브 로그인 시트를 띄우기 전 확인으로만 부른다(표식은 버림). 409 REAUTH_REQUIRED, PROVIDER_ALREADY_LINKED, 503 미설정 |
| POST | `/me/auth-accounts` | 유저 + 최근 로그인 | 넷 중 하나: `{ ticket }` \| `{ provider: 'KAKAO', accessToken }` \| `{ provider: 'APPLE', identityToken, authorizationCode, nonce }` \| `{ provider: 'EMAIL', email, code }` | `{ data: { account: AuthAccountView, absorbed: boolean } }`. 이미 내 것이면 200 그대로(`absorbed: false`). 400 LINK_TICKET_INVALID, EMAIL_CODE_*, 401 SOCIAL_TOKEN_INVALID, 409 REAUTH_REQUIRED, PROVIDER_ALREADY_LINKED, AUTH_ACCOUNT_IN_USE |
| DELETE | `/me/auth-accounts/:id` | 유저 | - | `{ data: { ok: true } }`. 제공자 unlink(카카오 연결 끊기, Apple 토큰 폐기)를 먼저 하고 실패하면 502 KAKAO_ERROR \| APPLE_ERROR 로 DB 그대로 (탈퇴와 같은 원칙). 마지막 하나면 409 LAST_AUTH_ACCOUNT, 남의 것이나 없음은 404. 이메일이면 그 이메일 발송 기록도 지운다. 세션은 그대로 |

```ts
AuthAccountView = { id, provider: 'KAKAO' | 'APPLE' | 'EMAIL' | ..., label, createdAt }
// label: 이메일은 가린 주소(ki***@gmail.com), 카카오 "카카오 계정", Apple "Apple ID"(이메일을 받지 않아 주소를 보일 수 없다, D-50)
```
- **웹 OAuth(카카오, Apple)**: 웹 `POST /me/link/start`(form, 같은 출처) → `link-start` 로 intent → 302 `/v1/auth/<kakao|apple>?mode=link&intent=&next=` (표식이 틀리면 OAuth 로 가지 않고 웹 `/me/link?error=LINK_TICKET_INVALID`). intent 는 OAuth state 에 실려 콜백에서 다시 검증한다. 콜백은 로그인하지 않고 **연결 티켓**(`AuthLinkTicket`: 32바이트 랜덤, DB 에는 sha256hex 만, 5분, 1회, 시작한 사용자 `userId` 에 묶임, Apple 은 refresh token 포함)을 만들어 302 `${WEB_ORIGIN}/me/link?ticket=&next=` (실패는 `?error=&next=`). 웹 `/me/link` route handler 가 그 기기 세션으로 `POST /me/auth-accounts { ticket }`. 티켓은 세션 사용자 = 시작한 사용자일 때만 소비된다(다른 세션은 400 이고 소비되지 않음)
- **앱 토큰**: `/auth/kakao/native`(access_token_info 의 app_id), `/auth/apple/native`(번들 ID aud, nonce 필수, 코드 교환, sub 일치) 와 같은 검증. 앱 안에서는 웹 화면이 `link-start` 로 최근 로그인을 먼저 확인하고, 셸 브리지 `linkAccount`(`앱.md` 4.8)로 네이티브 로그인 결과만 받아 그 기기 세션으로 이 본문을 보낸다. 셸은 API 를 부르지 않는다. 1.2.0 바이너리에 OTA 로 들어간다(D-282)
- **이메일**: `POST /auth/email/request { email, purpose: 'LINK' }` 를 웹 서버가 `X-Internal-Key` + 세션 Bearer 로 부른다(세션 없거나 틀림 401, 오래됨 409 REAUTH_REQUIRED). 행은 `purpose LINK, userId`, 메일은 코드만(로그인 링크 없음, 심사 계정 예외 없음). 같은 쓰임끼리만 이전 메일을 무효로 하고, LINK 코드는 `/auth/email/code`, `/auth/email/link` 로그인에 쓰이지 않는다. 확인은 `POST /me/auth-accounts { provider: 'EMAIL', email, code }` 가 그 사용자의 살아 있는 최신 LINK 행과 대조(틀린 횟수, 잠금, 만료는 로그인 코드와 같은 규칙). 이슈 초안의 `challengeId` 대신 email 로 찾는다(로그인 코드 경로와 같은 방식, id 를 밖에 내지 않음)
- **연결 판정(한 트랜잭션)**: 내 User 행 `FOR UPDATE` → 연결하려는 `(provider, providerUserId)` 행 `FOR UPDATE` → 내 것이면 200 → 내가 같은 제공자를 가졌으면 409 PROVIDER_ALREADY_LINKED → 다른 사용자(B) 것이면 B 를 잠그고 빈 계정 판정, 아니면 409 AUTH_ACCOUNT_IN_USE → 비었으면 **흡수**: B 의 개인 팀, AuthHandoff, PushDevice, LINK 메일 행, 파일 행을 지우고 그 AuthAccount 를 나에게 옮긴 뒤 B 삭제(제공자 unlink 안 함, 파일 객체는 커밋 뒤 삭제). B 의 다른 기기 세션은 다음 요청에서 401. 없으면 새로 만든다. 동시 생성의 유일키 충돌, 교착은 한 번 다시 판정
- **빈 계정(B)**: 연결 계정이 그 하나뿐, 멤버십은 개인 팀 하나뿐, 개인 팀에 다른 멤버, 일정, 기념일, 할 일 목록, 투표, 가져오기, 공유 링크, 새 소식 기록, 팀 활동, 삭제 보관, 구독 주소, 알림 묶음이 0, 사용자 단위로 만든 일정과 기념일, 기록, 활동, 가져오기, 일정 참여, 공유 링크, 할 일(만들기, 고치기, 완료), 구독 주소, 참석 응답, 반응, 투표(만들기, 표, 대상), 알림 설정 행, 삭제 보관, 사진 밖의 파일이 0, 생일 없음, 처음 여는 달력 LAST, 생일 알림 시점 기본(당일). 하나라도 있으면 막는다. User, Group 의 관계가 늘면 `auth-accounts.repository.spec` 의 스키마 대조 테스트가 깨진다

**이메일 로그인 (#245)** — 규칙 전체는 `이메일-로그인.md` 4장. 모두 인증 없음, **웹 서버 전용**: 헤더 `X-Internal-Key` 가 `INTERNAL_API_KEY` 와 같아야 하고(다르거나 없으면 403 FORBIDDEN, 키가 비어 있으면 개발에서만 통과), 그때만 `X-Client-IP` 를 IP 횟수 제한에 쓴다(없으면 `"unknown"`). 스위치 `EMAIL_LOGIN_ENABLED !== '1'` 이면 전부 503 EMAIL_NOT_CONFIGURED. 응답은 오류 포함 `Cache-Control: no-store`. `client` 는 `"web"`(기본) 또는 `"app"`, `"app"` 으로 로그인되면 `User.lastAppLoginAt = now` (D-97)

| 메서드 | 경로 | 요청 | 응답 |
|--------|------|------|------|
| POST | `/auth/email/request` | `{ email, next? }`. email 은 앞뒤 공백 제거 + 소문자, ASCII `로컬@도메인.최상위`, 191자 이하. next 는 sanitizeNext | `{ data: { cooldownSec: 60, expiresInSec: 900 } }`. 가입 여부, 발송 성공과 무관하게 같다. 제한 위반은 429 EMAIL_RATE_LIMITED (이메일 60초 1번 COOLDOWN, 1시간 5번 HOURLY, 같은 IP 1시간 20번 IP). 같은 이메일의 이전 링크와 코드는 무효. 심사 이메일(`REVIEW_EMAIL`)이면 메일을 보내지 않고 `REVIEW_CODE` 가 코드 |
| POST | `/auth/email/link/inspect` | `{ token }` | `{ data: { state: "VALID" \| "EXPIRED" \| "USED" \| "INVALID", emailMasked } }`. 소비하지 않는다(D-113). `emailMasked` 는 `ki***@gmail.com`, INVALID(없음, 형식 틀림)면 null |
| POST | `/auth/email/link` | `{ token, client? }` | `{ data: AuthResult }`. 1회 소비. 실패 400 EMAIL_LINK_INVALID `{ reason }` |
| POST | `/auth/email/code` | `{ email, code(6자리 숫자), client? }` | `{ data: AuthResult }`. 그 이메일의 살아 있는 최신 메일과 대조. 실패 400 EMAIL_CODE_INVALID `{ attemptsLeft }`, 5번째 틀림 EMAIL_CODE_LOCKED, 살아 있는 메일 없음 EMAIL_CODE_EXPIRED |
| POST | `/auth/email/signup` | `{ signupToken, nickname(앞뒤 공백 제거 2~20자), client? }` | `{ data: { token, next } }`. 가입 티켓 1회 소비 → User + AuthAccount(EMAIL) + 개인 팀. 같은 이메일이 먼저 가입했으면 그 계정으로 로그인(닉네임 무시). 실패 401 SIGNUP_TOKEN_INVALID |

```ts
type AuthResult =
  | { kind: "SESSION"; token: string; next: string }     // 기존 이메일 계정. token = 세션 JWT
  | { kind: "SIGNUP"; signupToken: string; next: string } // 처음 이메일. 30분 안에 /auth/email/signup
```
- 링크와 코드는 15분 유효, 한 메일에서 하나를 쓰면 둘 다 끝. `next` 는 요청 때 저장한 값(링크를 다른 기기에서 열어도 같다)
- `AuthAccount(provider: EMAIL, providerUserId: 정규화 이메일, email: 같은 값, rawProfile: null)`. 카카오, 애플 계정과 합치지 않는다

```ts
// (#300) 처음 여는 달력. 저장은 User.startCalendarMode(기본 LAST) + User.startGroupId(Group FK, SetNull)
StartCalendar = { mode: 'LAST' | 'PERSONAL' | 'GROUP', groupId: number | null }   // groupId 는 GROUP 일 때만 값
```
- GROUP 인데 팀이 없는 행(FK SetNull)은 LAST 로 읽는다. 고정한 팀에서 나가거나 팀이 지워지면 그 트랜잭션 안에서 LAST 로 되돌린다 (2.7, D-192)
- 웹 `/` 진입에서만 쓴다 (화면흐름.md 1장). 딥링크는 따르지 않는다

로그아웃은 웹이 쿠키를 지운다. 앱이면 그 전에 웹 route handler 가 `DELETE /me/push-devices { token }` 으로 이 기기 푸시 토큰을 지운다 (2.8, D-83).

### 2.2 팀

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups` | 유저 | - | `{ data: GroupSummary[] }` — PERSONAL 먼저, 그다음 joinedAt 순 |
| POST | `/groups` | 유저 | `{ name, preset? }` | 201 `{ data: GroupDetail }`. type 은 항상 TEAM, 요청자가 첫 멤버, 초대 코드 발급. (#278, D-250) `preset` 은 만들기 화면의 쓰임(`two`, `family`, `friends`, `study`)으로 **저장도 응답도 하지 않고** 로그 한 줄(`groups.create groupId= preset=`)만 남긴다. 모르는 값, 다른 형식도 400 없이 무시 |
| GET | `/groups/:groupId` | 멤버 | - | `{ data: GroupDetail }` |
| PATCH | `/groups/:groupId` | 멤버 | `{ name }` | `{ data: GroupDetail }` |
| POST | `/groups/:groupId/invite-code` | 멤버 | - | `{ data: { inviteCode, inviteUrl, inviteShareUrl } }`. 새 코드로 교체, 이전 코드 즉시 무효. (#274) 그 팀의 일정 공유 링크도 모두 끊는다. PERSONAL 이면 GROUP_NOT_INVITABLE |
| GET | `/invites/:code?by=` | 선택 | `by?`(보낸 사람 표식) | `{ data: InvitePreview }`. 로그인 전 미리보기. 토큰이 없거나 틀리거나 만료돼도 401 이 아니라 익명으로 답한다 (#196, D-157, D-158) |
| POST | `/groups/join` | 유저 | `{ code }` | `{ data: GroupDetail }`. 이미 멤버면 그대로 200 (멱등). 코드 없으면 INVITE_NOT_FOUND |
| PATCH | `/groups/:groupId/me` | 멤버 | `{ color?, displayName?, notify?, showBirthday? }` | `{ data: Member & { notify, showBirthday } }`. displayName 에 `null` 을 보내면 닉네임으로 되돌림. `notify` 는 이 팀 알림 받기 (#188, 불리언 아니면 400). `showBirthday` 는 이 팀 달력에 내 생일 보이기 (#305, 기본 true, 불리언 아니면 400) |
| DELETE | `/groups/:groupId/me` | 멤버 | - | `{ data: { groupDeleted: boolean } }`. 팀 나가기 (2.7) |

```ts
GroupSummary = { id, type: 'PERSONAL'|'TEAM', name, publicCode, memberCount, me: { color, displayName }, unreadNewsCount,
                 hidden: { reason, hiddenAt } | null }   // publicCode: (#311) 주소용 공개 코드. hidden: (#515) 운영 숨김(D-286), 숨긴 팀은 unreadNewsCount 0
GroupDetail  = { id, type, name, inviteCode: string|null, inviteUrl: string|null, inviteShareUrl: string|null, publicCode, createdAt,
                 members: Member[], me: Member & { notify: boolean; showBirthday: boolean } }   // notify: (#188) 나의 "이 팀 알림 받기", showBirthday: (#305) "이 팀 달력에 내 생일 보이기". 다른 멤버 값은 싣지 않는다
Member       = { userId, displayName, color, profileImageUrl, joinedAt }
InvitePreview = { groupName, memberCount,
                  inviter: { nickname: string } | null,   // (#196) by 가 이 팀 현재 멤버의 표식과 맞을 때만. 팀 표시 이름, 사진 없음
                  isMember: boolean,                       // (#196) 유효한 토큰의 사용자가 이미 멤버
                  groupId: number | null,                  // (#196) isMember 일 때만 값. 비멤버에게 팀 id 를 주지 않는다
                  groupCode: string | null }               // (#311) isMember 일 때만. 웹이 `/calendar?team=<코드>` 로 간다
```

- (#311, D-197) `publicCode`: 주소(`?team=<코드>`), 알림, 위젯에서 팀 번호 대신 쓰는 공개 코드. 혼동 글자(0 o 1 l)를 뺀 소문자 영숫자 8자(`common/public-code.ts`), 유일, 바뀌지 않음. 초대 코드와 다르고 아무 권한도 주지 않는다(멤버십 검사는 그대로). 마이그레이션 `20261112120000_public_codes` 가 기존 팀, 일정에 같은 알파벳으로 채웠다

- `inviteUrl` = `${WEB_ORIGIN}/join/${inviteCode}`
- `inviteShareUrl` = `inviteUrl + "?by=" + 표식`. 표식은 요청자 기준이라 같은 팀도 멤버마다 다르다. 코드가 없으면(PERSONAL) null. 표식은 `base64url(HMAC-SHA256(HKDF(JWT_SECRET, "wwm-invite-by"), "<groupId>:<userId>"))` 앞 10자 (D-157). 복사, 공유는 이 주소를 쓴다
- `by` 가 10자 base64url 이 아니거나 어떤 현재 멤버와도 맞지 않으면(나간 멤버, 다른 팀 표식, 위조) `inviter: null`. 오류를 내지 않는다
- `unreadNewsCount` = 그 팀 EventLog 중 `createdAt > me.lastSeenAt` 이고 `actorId != me` 인 건수. 팀 수만큼 count 쿼리 (사용자당 팀 수가 작아 허용)
- 초대 코드: 알파벳 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (혼동 문자 제외) 6자. 충돌 시 재생성. 입력은 대문자로 정규화
- 멤버 색: 합류 시 아래 팔레트 8색 중 그 팀에서 가장 적게 쓰인 색을 자동 배정(동률은 순서, #343 부터 8번째 `#F279B5` = 핑크 포함, D-215). 검증은 `^#[0-9A-Fa-f]{6}$` 만 (팔레트 밖 값도 허용)
- 같은 팔레트를 일정 색(`Event.color`)에도 쓴다. 화면 이름은 순서대로 블루, 머스터드, 틸, 바이올렛, 그린, 브라운, 슬레이트, 핑크

```
MEMBER_COLORS = ['#F26D6D','#F2994A','#F2C94C','#6FCF97','#56CCF2','#5B6CF4','#A66CF4','#F279B5']
```

### 2.3 일정

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/events` | 멤버 | 쿼리 `from`, `to` (ISO, `to - from <= 62일`) | `{ data: Event[] }` 반복 원본은 기간 안 회차로 펼친다. `startsAt` 오름차순, 같으면 `id`, 그다음 `occurrence` |
| POST | `/groups/:groupId/events` | 멤버 | `EventInput` | 201 `{ data: Event }` (반복이면 첫 회차) + EventLog CREATED |
| GET | `/groups/:groupId/events/:eventId` | 멤버 | 쿼리 `occurrence?` | `{ data: Event & { hasLaterExceptions } }` |
| GET | `/events/search` | 유저 | 쿼리 `q`, `groupId?`, `limit?` | (#199) 일정 검색. 아래 "일정 검색" |
| GET | `/events/:code` | 유저 | 쿼리 `occurrence?` | (#311) 일정 공개 코드로 단건 조회. 응답은 위와 같다. 코드 모양이 틀리거나 없거나 **그 팀 멤버가 아니면 모두 404 NOT_FOUND** (코드의 존재를 드러내지 않는다, D-197). 웹 `/events/<코드>` 페이지가 팀과 날짜를 알아내는 데 쓴다 |
| PATCH | `/groups/:groupId/events/:eventId` | 멤버 | `Partial<EventInput>`, 쿼리 `occurrence`, `scope` (반복만) | `{ data: Event }` + EventLog UPDATED. 현재 값과 합친 결과가 그대로면(빈 본문, 같은 값, 같은 순간의 다른 오프셋 표기) 저장하지 않고 로그도 남기지 않으며 `updatedAt` 그대로 200 |
| DELETE | `/groups/:groupId/events/:eventId` | 멤버 | 쿼리 `occurrence`, `scope` (반복만) | `{ data: { ok: true, deletionId } }` + EventLog DELETED (삭제 전 스냅샷). (#375) `deletionId` 로 7일 안에 되돌릴 수 있다 (D-251) |
| POST | `/groups/:groupId/event-deletions/:deletionId/restore` | 멤버 (팀원 누구나) | - | (#375) 삭제 되돌리기 `{ data: { ok: true, eventId, occurrence } }` (`occurrence` 는 회차 삭제의 날짜, 행째 지운 것은 null). 지우기 직전 모습(일정 행, 번호와 공개 코드, 예외, 참여자, 응답, 반응, 공유 링크, 기록과 투표 연결) 그대로. 삭제의 DELETED 로그는 지워 새 소식에서 숨기고, 아직 안 보낸 팀원 변경 알림은 삭제 전으로 되돌린다. 없거나 다른 팀이거나 7일이 지났거나 이미 되돌렸으면 404 NOT_FOUND("되돌릴 수 있는 기간이 지났어요"), 그 사이 일정이 바뀌어 그대로 되돌릴 수 없으면 409 EVENT_RESTORE_CONFLICT. 나간 멤버의 참여자, 응답, 반응은 넣지 않는다 (D-251) |
| PUT | `/groups/:groupId/events/:eventId/rsvp` | 멤버 (그 회차 참여자) | 쿼리 `occurrence` (반복은 필수), `{ status: Rsvp \| null }` (null = 응답 취소) | (#190) `{ data: Event['rsvp'] }` + GroupActivity EVENT_RSVP (2.6) |
| PUT | `/groups/:groupId/events/:eventId/reaction` | 멤버 | 쿼리 `occurrence` (반복은 필수), `{ reaction: Reaction \| null }` | (#190) `{ data: Event['reactions'] }`. 새 소식 없음 |

```ts
EventInput = { title: string(1~50), startsAt: ISO, endsAt: ISO, allDay: boolean, memo?: string(≤500),
               repeat?: 'WEEKLY'|'BIWEEKLY'|'MONTHLY'|'YEARLY'|null,   // 생략/null = 한 번짜리 (#187)
               repeatUntil?: 'YYYY-MM-DD'|null,                        // KST, 그날 시작하는 회차 포함. 생략/null = 계속
               reminder?: EventReminder,                               // (#188) 생성에서 생략 = 'NONE', 수정에서 생략 = 그대로 (2.8)
               participants?: 'ALL'|number[],                          // (#248) 'ALL' = 지금 멤버 전원(#444 부터 id 목록으로 저장, D-263), 배열 = 멤버 userId. 생성에서 생략 = [요청자], 수정에서 생략 = 그대로
               color?: string|null }                                   // (#343) MEMBER_COLORS 키 하나(대소문자 무시, 대문자로 저장). null = 자동. 생성에서 생략 = null, 수정에서 생략 = 그대로
Event      = { id, groupId, publicCode, title, startsAt, endsAt, allDay, memo, creator: Member|탈퇴자, createdAt, updatedAt,   // publicCode: (#311) 주소용 공개 코드 (`/events/<코드>`)
               repeat, repeatUntil,
               occurrence: 'YYYY-MM-DD'|null,   // 회차의 원래 날짜 (KST). 한 번짜리는 null
               seriesStartsAt: ISO|null,        // 반복이면 원본 첫 회차 시작
               repeatAnchor: 'YYYY-MM-DD'|null,  // (#228) 반복 기준 날짜 (KST). 매월은 일, 매년은 월일. null = seriesStartsAt 의 KST 날짜. 응답에만 (입력 아님), 한 번짜리는 null
               reminder: EventReminder,          // (#188) 그 회차의 실제 알림 (예외 반영)
               participants: { all: boolean, members: Member[] },    // (#248) all 이면 지금 멤버 전원, 아니면 참여자(0 = 참여자 없음). 가입순. 반복 회차는 원본 값
               color: string|null }                                  // (#343) 일정 색. null = 자동(화면은 참여자 색). 반복 회차는 원본 값
// 단건 GET 만: hasLaterExceptions: boolean   // 이 회차보다 뒤에 "이 일정만" 예외(취소 포함)가 있는지. 한 번짜리는 false
// (#190) 목록, 단건, 생성, 수정 공통 (그 회차의 집계)
Event += { rsvp: { going, notGoing, maybe, pending, mine: Rsvp|null },        // pending = 참여자 중 아직 응답 안 한 사람 수
           reactions: { LIKE, EXCITED, ACK, mine: Reaction|null } }           // 지금 팀원의 반응만 센다
// (#190) 단건 GET 만
EventDetail += { rsvpMembers: { member: Member, status: Rsvp|null, respondedAt: ISO|null, stale: boolean }[],  // 참여자 가입순. stale = 응답한 뒤 그 회차 시작/끝이 바뀜 (D-226)
                 reactionMembers: { member: Member, reaction: Reaction }[] }                                  // 반응한 지금 팀원, 가입순
Rsvp = 'GOING'|'NOT_GOING'|'MAYBE'
Reaction = 'LIKE'|'EXCITED'|'ACK'      // 화면 글자: 좋아요, 기대돼요, 확인했어요
```

- (#190) 참석 여부와 반응 (설계 `참석-여부.md`, D-224 ~ D-228)
  - 회차 단위: 반복은 `(eventId, 원래 회차 날짜)`, 한 번짜리는 `(eventId, 시작 KST 날짜)`. 반복에서 `occurrence` 가 없으면 400 VALIDATION_FAILED `field: 'occurrence'`, 회차가 아니거나 취소된 회차면 404 NOT_FOUND (단건 GET 과 같은 규칙). 한 번짜리는 `occurrence` 를 무시
  - rsvp 는 그 일정의 참여자만 (모두면 지금 팀원 전원). 아니면 403 NOT_PARTICIPANT. 확인은 쓰기 트랜잭션 안에서 멤버십과 일정 행을 `FOR SHARE` 로 읽어 한다. reaction 은 팀원 누구나
  - 본문 형식 오류(빠짐, 다른 값, 다른 필드)는 400 VALIDATION_FAILED. 경로에 사람이 없어 남의 응답은 바꿀 수 없다
  - 같은 값이면 저장, 기록 모두 없다 (#62). 지난 회차도 응답할 수 있다
  - 목록 집계는 창 안 회차 날짜 범위로 응답, 반응을 한 번씩 더 읽는다 (PK `(eventId, occurrence, userId)`)
  - 정리: 참여자에서 빠지면 그 사람 응답 삭제(반응은 남김), 팀 나가기는 그 팀 일정의 내 응답, 반응 삭제, 탈퇴는 Cascade. "이 일정만" 삭제는 그 회차 응답, 반응 삭제. "이후 모두" 로 나누면 그 회차 이후를 새 원본으로 옮기고, 시작 날짜나 주기가 바뀌면 지운다. 첫 회차 "이후 모두" 는 회차 날짜(시작 날짜, 주기, 기준 날짜)가 바뀌면 전부 지운다. 한 번짜리 날짜를 옮기면 회차 날짜를 따라 옮긴다 (D-225)
  - 시각이 바뀌어도 응답은 지우지 않는다. `stale` 로 알린다 (D-226)
  - 일정 알림(REMINDER)은 그 회차에 불참으로 답한 사람에게 보내지 않는다 (D-228)

- (#248) 참여자 (`일정-참여자.md`, D-130 ~ D-139). 저장은 `Event.allMembers`(true = "모두", 나중 합류자 포함) + `EventParticipant` 행. 개인 팀도 같은 규칙. (#444) 새로 쓰는 값은 항상 `allMembers = false` + 행이고 기존 "모두" 는 마이그레이션으로 행이 됐다 (D-263)
  - 응답 `participants` 는 목록, 단건, 생성/수정 모두 같은 모양. `members` 는 지금 멤버만(나가면 행이 지워진다), 순서는 `Membership.joinedAt`. `creator` 는 그대로 ("○○님이 추가")
  - 검증 (400 VALIDATION_FAILED, `field: 'participants'`):

    | 입력 | 결과 / message |
    |------|------|
    | 생략 | 생성: `[요청자]`. 수정: 그대로 (참여자 없음 일정도 다른 필드는 고칠 수 있다) |
    | `'ALL'` | (#444) 그 시각 팀 멤버 전원 id 를 참여자 행으로 (`allMembers = false`, 나중 합류자 제외, D-263) |
    | 양의 정수 1~50개 | 중복은 합친다. 전원을 하나씩 골라도 `'ALL'` 로 바꾸지 않는다 |
    | `[]` | 참여자를 한 명 이상 골라 주세요 |
    | 50명 초과 | 참여자는 최대 50명까지 고를 수 있어요 |
    | 이 팀 지금 멤버가 아닌 id 포함 | 이 팀 멤버만 참여자로 고를 수 있어요 (저장 트랜잭션 안에서 멤버십을 `FOR SHARE` 로 읽어 확인) |
    | `null`, 다른 문자열, 숫자 아닌 원소 | participants 는 'ALL' 또는 멤버 id 배열이어야 해요 |
  - 참여자만 바꿔도 수정: UPDATED 로그 + 팀원 변경 알림. 같은 참여자(순서 무관)면 #62 규칙대로 저장 안 함
  - `EventLog.participantsAll`, `participantIds`(오름차순, 모두면 null): CREATED, UPDATED 는 저장 후 값, "이 일정만" 은 원본 값, DELETED 는 null. 새 소식 응답과 문구는 그대로
- (#343) 일정 색 (D-215). 저장은 `Event.color CHAR(7) NULL`
  - 팔레트 키 8개 밖 값(형식이 맞는 다른 hex, 문자열 아닌 값, 빈 문자열)은 400 VALIDATION_FAILED `field: 'color'` "색은 정해진 8색 중 하나여야 해요"
  - **색만 바꾼 수정은 EventLog(새 소식)와 푸시를 만들지 않는다.** 색과 다른 값을 같이 바꾸면 보통 수정(UPDATED 한 줄, 색 포함). 같은 색이면 #62 규칙대로 저장 안 함
  - 반복 일정은 원본 단위(예외에 색 없음). `scope=this` 본문에 `color` 가 있으면(같은 값, null 이어도) 400 `field: 'color'` "반복 일정의 색은 이후 모두로만 바꿀 수 있어요". `following` 첫 회차는 원본 색, 그 뒤 회차는 새 원본에(생략이면 원본 색 복사). 색만 바꿨고 그 회차부터 예외가 없으면 첫 회차는 색만 저장(예외 유지), 그 뒤 회차는 로그 없이 나눈다
  - ICS 가져오기는 null(자동). 공유 미리보기 `EventSharePreview.event.color`
- 조회 조건은 겹침: `startsAt < to AND endsAt > from` (인덱스 `(groupId, startsAt)`). 반복 회차는 최종 시각(예외 반영) 기준으로 같은 조건
- `endsAt > startsAt` 이어야 하고 길이 30일 이하. 아니면 EVENT_RANGE_INVALID
- 종일(`allDay: true`): 클라이언트가 `startsAt` = 그날 KST 00:00, `endsAt` = 다음 날 KST 00:00 (UTC 로 변환) 을 보낸다. 서버는 그 두 값이 KST 자정인지 검증하지 않는다 (표시는 allDay 플래그만 본다)
- 팀원 누구나 수정/삭제. 등록자 제한 없음
- 단건(GET/PATCH/DELETE)의 `eventId` 는 `groupId` 안에서만 찾는다. 멤버가 아니면 403 FORBIDDEN, 멤버이지만 다른 팀 소속 일정이면 없는 ID 와 똑같이 404 NOT_FOUND (존재 여부 비노출. 결정기록 D-31)

#### 반복 일정 (#187, D-63 ~ D-67, D-71)

설계 근거는 `반복-일정.md`. 회차는 저장하지 않고 서버가 조회 기간만 펼친다 (`apps/api/src/events/recurrence.ts`).

- 회차의 주소는 `(id, occurrence)`. 화면 키는 `${id}:${occurrence ?? ''}`. 회차 날짜는 원래 날짜라 "이 일정만" 으로 옮겨도 바뀌지 않는다
- 회차 날짜: 첫 회차 KST 날짜 기준 매주 +7일, 격주 +14일, 매월 같은 날(없는 달은 말일), 매년 같은 월일(2/29 는 평년 2/28). 매월/매년의 "같은 날(월일)" 은 `repeatAnchor` 가 있으면 그 날짜 기준 (D-71). 시각은 원본의 KST 벽시계 시각, 길이는 원본 길이
- `occurrence`, `scope` 쿼리는 **한 번짜리 일정이면 무시**한다 (값이 틀려도 지금과 같다)
- 반복 일정의 단건 GET: `occurrence` 가 없거나 빈 값이면 첫 회차. PATCH/DELETE 는 `scope` 가 없거나 `this`/`following` 이 아니면 400 VALIDATION_FAILED (`details[0].field = 'scope'`), `occurrence` 가 없거나 `YYYY-MM-DD` 실제 날짜가 아니면 400 (`field: 'occurrence'`)
- `occurrence` 가 규칙상 회차 날짜가 아니거나, `repeatUntil` 뒤, 또는 취소된 회차면 404 NOT_FOUND

| 동작 | 처리 (트랜잭션 1개) | 응답 | 로그 |
|------|------|------|------|
| PATCH this | `EventException(eventId, occurrence)` upsert. 원래 회차와 다른 필드만 저장, 모두 원래 값이 되면 예외 행 삭제. 본문에 `repeat`/`repeatUntil` 이 있으면 400 VALIDATION_FAILED. (#248) 본문에 `participants` 가 있으면(같은 값이어도) 400 "이 일정만 수정할 때는 참여자를 바꿀 수 없어요" | 그 회차 | UPDATED, scope THIS |
| PATCH following, 첫 회차 | 원본 수정 + 원본의 예외 전부 삭제. (#248) 참여자도 원본 값을 바꾼다 | 수정된 첫 회차 (반복을 끄면 한 번짜리) | UPDATED, scope FOLLOWING |
| PATCH following, 그 뒤 회차 | 원본 `repeatUntil = occurrence - 1일`, `occurrence` 이후(그날 포함) 예외 삭제, 새 Event 생성 (`creatorId` = 원본 등록자, `repeatAnchor` 는 아래. (#248) 참여자는 본문 값, 없으면 원본 참여자 복사. 끊긴 원본의 참여자는 그대로) | 새 원본의 첫 회차 | UPDATED, scope FOLLOWING, `eventId` = 새 원본 |
| DELETE this | 예외 upsert `cancelled = true` | `{ ok: true }` | DELETED, scope THIS |
| DELETE following, 첫 회차 | 원본 삭제 (예외 cascade) | `{ ok: true }` | DELETED, scope FOLLOWING (`eventId` 는 SetNull 로 null) |
| DELETE following, 그 뒤 회차 | 원본 `repeatUntil = occurrence - 1일`, 이후 예외 삭제 | `{ ok: true }` | DELETED, scope FOLLOWING |

- PATCH this 의 기준 값은 **그 회차의 현재 값**(예외 반영) + 본문. PATCH following 의 기준 값은 **그 회차의 규칙 자리**(원래 회차 날짜 + 원본 시각과 값, 말일 보정 그대로, 예외 적용 전) + 본문 (#228, D-71). "이후 모두" 에서 `repeat` 생략은 그대로, `null` 은 반복 끄기(`repeatUntil` 도 null). `repeatUntil` 생략은 그대로
- (#228, D-71) "이후 모두" 에서 날짜를 바꾸지 않으면(`startsAt` 이 없거나 그 KST 날짜가 원래 회차 날짜) 규칙을 잇는다. 그 뒤 회차: 새 원본은 규칙 자리에서 시작하고, 주기가 그대로인 MONTHLY/YEARLY 면 `repeatAnchor = 원본.repeatAnchor ?? 원본 시작 KST 날짜` (매월 31일을 2/28 회차에서 나눠도 3-31, 4-30. 매년 2/29 를 2027-02-28 에서 나눠도 2028-02-29). 첫 회차: 원본 `repeatAnchor` 그대로. 날짜나 주기를 바꾸면 `repeatAnchor = null`. 주간은 항상 null. 웹은 시작, 종료를 그대로 두면 `startsAt`, `endsAt` 을 빼고 보낸다
- "이후 모두" 로 시작 시각/날짜를 바꾸면 새 원본의 첫 회차가 되어 요일, 날짜 기준도 따라 바뀐다
- 메모를 지운 "이 일정만" 예외는 `memo = ''` 로 저장한다 (null 은 원본 값. D-65). 응답 `memo` 도 `''`
- (#199) 장소도 메모와 같은 규칙으로 "이 일정만" 예외에 둔다: 예외 `placeName` 이 null 이면 원본 장소, `''` 이면 그 회차만 장소 없음(응답 `place: null`), 값이 있으면 다섯 값이 원본 장소 전체를 대신한다. "이후 모두" 로 나누면 새 원본에 복사 (D-242)
- 같은 값이면 저장하지 않는 규칙(#62): this 는 회차의 현재 값과 같으면 no-op. following 첫 회차는 원본 값, 규칙이 같고 예외가 없으면 no-op. following 그 뒤 회차는 원래 회차 값, 규칙이 같고 그 회차부터 예외가 없으면 no-op (나눠도 결과가 같다)
- 한 번짜리 일정을 PATCH 해 `repeat` 을 켜면 그 일정이 첫 회차가 된다 (scope 불필요)

검증 (설계 4-1):

| 조건 | 오류 | message |
|------|------|---------|
| 길이 >= 주기 (WEEKLY 7일, BIWEEKLY 14일, MONTHLY 28일, YEARLY 365일) | EVENT_RANGE_INVALID | 반복 간격보다 긴 일정은 반복할 수 없어요 |
| `repeatUntil` < 첫 회차 KST 날짜 | EVENT_RANGE_INVALID | 종료 날짜는 시작 날짜 뒤여야 해요 |
| `repeatUntil` 만 있고 `repeat` 없음 | VALIDATION_FAILED (`field: 'repeatUntil'`) | 반복 주기 없이 종료 날짜만 정할 수 없어요 |
| this 예외: 시작 < 원래 날짜 00:00 - 30일, 또는 끝 > 다음 날 00:00 + 30일 (KST) | EVENT_RANGE_INVALID | 이 회차는 앞뒤 30일 안으로만 옮길 수 있어요 |
| following: `repeatAnchor` 가 있는데 시작 날짜가 그 달(해)의 보정된 기준 날짜가 아님 (#228, 정상 흐름에선 안 나오는 방어 검사) | EVENT_RANGE_INVALID | 반복 기준 날짜와 시작 날짜가 맞지 않아요 |
| `repeat` 이 넷 중 하나가 아님, `repeatUntil` 이 실제 날짜가 아님 | VALIDATION_FAILED | DTO 문구 |
| 기존 규칙 (종료 > 시작, 30일 이하) | 그대로 (먼저 검사) | 그대로 |

#### 장소 (#199, D-242 ~ D-244, D-259)

카카오 정책상 **카카오가 준 이름, 주소, 좌표는 저장하지 않는다**. 네이버로 고른 장소도 같다(결과 원문을 저장하지 않는다). 저장은 사용자 입력과 장소 식별자(카카오 장소 ID, 네이버 키)뿐이다.

```ts
PlaceInput = { text?: string(≤100)|null,          // 고르지 않고 적은 장소 글자 (사용자 입력)
               query?: string(≤100)|null,         // 고를 때 사용자가 적은 검색어. kakaoPlaceId 나 naverKey 가 있으면 필수
               kakaoPlaceId?: string(숫자 1~20자)|null,   // 카카오에서 고른 장소
               naverKey?: string(소문자 16진 16자)|null } // (D-259) 네이버에서 고른 장소. 검색 결과의 naverKey 그대로
               // kakaoPlaceId 와 naverKey 는 하나만. 둘 다 없으면 text 필수. 다른 키(name, address, lat, lng, provider ...)는 400. 앞뒤 공백 자름
Place = { text: string|null, query: string|null, kakaoPlaceId: string|null, naverKey: string|null,
          provider: 'kakao'|'naver'|null,   // 고른 장소의 출처. 직접 적은 장소는 null
          url: string|null }   // 카카오 'https://place.map.kakao.com/<kakaoPlaceId>', 네이버 'https://map.naver.com/p/search/<query>' (서버가 만든다)
```

- 네이버 지역 검색은 고정 장소 ID 를 주지 않는다. `naverKey` = sha256(`이름\n주소`) 16진 앞 16자 (주소는 도로명, 없으면 지번. 서버가 검색 결과에서 만든다). 원문이 아니라 되돌릴 수 없는 값이다
- DB 열: `placeId`, `placeProvider`, `placeQuery`, `placeText` (Event, EventException). `placeId` 는 카카오 ID 또는 네이버 키, `placeProvider` 는 `KAKAO`/`NAVER` enum. `placeProvider` 가 null 인데 `placeId` 가 있으면 카카오(D-259 이전 행). 마이그레이션 `20261113121046_place_provider` (열 추가만)
- `EventInput.place?: PlaceInput | null`. 생성에서 생략 = 없음, 수정에서 생략 = 그대로, `null` = 지우기
- 이름, 주소, 좌표는 **보일 때마다 그 장소의 출처에서 다시 찾는다**: `GET /places/resolve?id=<kakaoPlaceId>&q=<query>` 또는 `?provider=naver&id=<naverKey>&q=<query>` (2.14) 가 그 검색어로 다시 검색해 식별자가 같은 결과를 준다. 서버는 5분 메모리 캐시, 웹은 탭 메모리만. 못 찾거나 검색이 안 되면 화면은 사용자 글자(`text`, 없으면 `query`) + 지도 검색 링크, 지도 없음
- 지도와 길찾기는 웹의 지도 선택(내 정보, 기기별, D-258)으로 그린다. 좌표는 WGS84 라 네이버로 고른 장소도 카카오 지도와 카카오 길찾기에, 그 반대도 쓸 수 있다 (D-259)
- 같은 장소면 저장하지 않는 규칙(#62)에 장소도 들어간다. 일정 기록(EventLog), 푸시 문구, 공유 링크 미리보기에는 넣지 않는다
- 구독 피드(2.12)는 피드를 만들 때 그 장소의 출처에서 다시 찾아 `LOCATION: 이름, 주소` + `GEO:위도;경도`, 못 찾으면 `LOCATION: 사용자 글자`, GEO 없음. 피드 하나에 서로 다른 장소 30개까지만 다시 찾는다. 메모 토글과 무관 (D-248)

#### 일정 검색 `GET /events/search` (#199, D-245, D-246)

| 쿼리 | 규칙 |
|------|------|
| `q` | 필수. 앞뒤 공백 자르고 1~50자. 아니면 400 VALIDATION_FAILED (`field: 'q'`) |
| `groupId` | 선택. 있으면 그 팀만, 멤버가 아니면 403 FORBIDDEN. 없으면 내가 속한 모든 팀 |
| `limit` | 선택. 기본 30, 1~50 |

```ts
// 200 { data: SearchResult }
SearchResult = {
  items: Array<{ event: Event,                       // 목록 응답과 같은 모양(응답 집계 rsvp, reactions 는 없음). 반복이면 회차 하나
                 group: { id, name, publicCode },
                 matched: Array<'title'|'memo'|'place'>, // 장소는 사용자 글자(text, query)
                 upcoming: boolean }>,                // 끝이 지금보다 뒤
  hasMore: boolean,                                   // limit 를 넘는 결과가 더 있다 (페이지 넘김 없음)
}
```

- 찾는 곳: 제목, 메모, 장소의 사용자 글자(`placeText`, `placeQuery`). 카카오 이름, 주소는 저장하지 않으므로 찾지 않는다. `LIKE '%q%' ESCAPE '!'` (`!`, `%`, `_` 는 글자 그대로), 열 콜레이션이라 대소문자 무시. 인덱스 추가 없음
- 권한: 첫 단계에서 내 멤버십으로 팀 목록을 정하고 그 팀 일정만 찾는다 (다른 팀 일정의 존재를 드러내지 않는다)
- 반복: 원본 값이 맞으면 한 줄, 회차는 **끝이 지금 뒤인 첫 회차**, 없으면 마지막 회차 (D-246). "이 일정만" 예외의 제목, 메모, 장소가 맞으면 그 회차를 따로 한 줄(그 회차는 원본 줄의 대표로 쓰지 않는다). 취소된 회차는 빠진다
- 정렬: 다가오는 일정 먼저 시작 오름차순, 그다음 지난 일정 시작 내림차순, 같으면 `id`, 회차 날짜
- 검색어는 저장하지 않는다 (스토어 "검색 기록: 수집 안 함" 유지)

### 2.4 기념일

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/anniversaries` | 멤버 | - | `{ data: Anniversary[] }` date 오름차순 |
| POST | `/groups/:groupId/anniversaries` | 멤버 | `{ name(1~30), date: 'YYYY-MM-DD', kind?, reminders? }` (kind 생략 시 `COUNT_UP`, reminders 생략 시 `['DAY_OF']`) | 201 `{ data: Anniversary }` |
| PATCH | `/groups/:groupId/anniversaries/:anniversaryId` | 멤버 | `{ name?, date?, kind?, reminders? }` | `{ data: Anniversary }` |
| DELETE | `/groups/:groupId/anniversaries/:anniversaryId` | 멤버 | - | `{ data: { ok: true } }` |

```ts
Anniversary = { id, groupId, name, date: 'YYYY-MM-DD', kind: AnniversaryKind, reminders: AnniversaryReminder[], creator: Member|탈퇴자, createdAt }
AnniversaryKind = 'COUNT_UP' | 'YEARLY' | 'ONCE'   // 함께한 날 세기(기본) / 매년 반복 / 그날만
AnniversaryReminder = 'DAY_OF' | 'DAY_BEFORE' | 'WEEK_BEFORE'   // (#269) 당일 / 하루 전 / 일주일 전, 모두 오전 9시 KST
```

D-day / D+N / 100일 단위 계산은 클라이언트 (화면흐름.md 7번).

기념일 종류 `kind` (#105, #106, D-62): 서버는 저장만 하고 응답(GET 목록, POST, PATCH)에 그대로 싣는다. 셋 외의 값과 `null` 은 400 VALIDATION_FAILED (`details[0].field = 'kind'`). 종류 도입 전 행은 `COUNT_UP`. 100일 단위, N주년, 매년 항목 계산은 클라이언트 (D-60). 규칙은 `docs/기획/기념일-자동표시.md`

#### 멤버 생일 (#305, D-230 ~ D-233)

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/birthdays` | 멤버 | - | `{ data: Birthday[] }` 가입순. 생일이 있고 그 팀 `showBirthday` 가 켜진 멤버(나 포함, 개인 팀이면 나만) |

```ts
Birthday = { member: Member, date: 'MM-DD' }   // member 는 팀 표시 이름 ?? 닉네임, 색
BirthdaySettings = { date: 'MM-DD' | null, reminders: AnniversaryReminder[] }   // GET /me, PATCH /me/birthday
```

- 저장은 `User.birthday`(CHAR 5) 하나. Anniversary 행을 팀마다 만들지 않고 화면, 알림, 피드가 계산한다. 쓰기는 `PATCH /me/birthday` 와 `PATCH /groups/:id/me { showBirthday }` 뿐
- 표시: 기념일 "매년 반복" 과 같은 규칙, 이름 "{표시 이름} 생일". 2월 29일은 평년에 2월 28일. 웹은 기념일 모양(음수 id, `kind: 'YEARLY'`, 기준 해 2000)으로 바꿔 달력 칸, 일 상세, 다가오는 일정, 사이드바, 위젯에 섞는다(`lib/birthday.ts`). 기념일 화면에서는 고칠 수 없는 줄(내 것은 내 정보 링크)
- 팀을 나가거나 탈퇴하면 멤버십이 없어져 그 팀에서 바로 빠진다. 새 소식(#191)에는 남기지 않는다
- 알림: 2.8 "생일 알림". 피드: 2.12 `includeAnniversaries` 를 따른다

기념일 알림 시점 `reminders` (#269, D-144, D-145): 기념일에 하나, 팀 공통. 응답은 항상 `DAY_OF, DAY_BEFORE, WEEK_BEFORE` 순서로 켜진 것만, `[]` 은 알림 없음. 요청은 배열(최대 3개, 위 셋 중, 중복 없음, 순서 무관). 배열이 아니거나 `null`, 모르는 값, 중복은 400 VALIDATION_FAILED (`details[0].field = 'reminders'`). #269 전 행은 `['DAY_OF']`. (#369) 저장은 `AnniversaryReminder(anniversaryId, offset)` 켜진 시점마다 행 하나(행 없음 = `[]`), 내 생일 시점도 같은 모양의 `BirthdayReminder(userId, offset)`(가입 때 `DAY_OF` 하나), D-249. 보내는 규칙은 `푸시-알림.md` 5-5

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
     select: { startsAt, endsAt, allMembers, participants: { userId } },   // title/memo 는 select 하지 않는다 (타 팀 내용 비노출)
     orderBy: { startsAt: 'asc' } })
   series = Event.findMany({               // 반복 원본 (#187, 반복-일정.md 4-2)
     where: { groupId in allGroupIds, repeat != null, startsAt < to + 31일,
              OR: [{ repeatUntil: null }, { repeatUntil >= (from - 31일) 의 KST 날짜 }] },
     select: { startsAt, endsAt, allDay, repeat, repeatUntil, repeatAnchor, allMembers, participants: { userId },
               exceptions: { occurrence, cancelled, startsAt, endsAt, allDay } } })   // 여기도 title/memo 없음
   → (#248) once, series 를 isBusyForAny 로 거른다: allMembers 이거나 참여자 중 memberIds 가 있으면 바쁨 (참여자 없음은 안 바쁨, D-137)
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
| GET | `/groups/:groupId/news` | 멤버 | `?v=2` (#191, 선택) | `{ data: { items: NewsItem[], lastSeenAt } }`. `v=2` 면 `items: (EventNewsItem \| ActivityNewsItem)[]` |
| POST | `/groups/:groupId/news/seen` | 멤버 | - | `{ data: { lastSeenAt } }`. `Membership.lastSeenAt = now` |

```ts
NewsItem = { id, action: 'CREATED'|'UPDATED'|'DELETED', eventId: string|null,
             eventCode: string|null,                                  // (#311) 원본의 공개 코드. 삭제됐으면 null
             title, startsAt, endsAt, allDay,
             repeat: 'WEEKLY'|'BIWEEKLY'|'MONTHLY'|'YEARLY'|null,   // 변경 시점의 반복 주기 (#187)
             scope: 'THIS'|'FOLLOWING'|null,                         // 반복 일정에서 고른 범위. 한 번짜리, 새 반복 추가는 null
             occurrence: 'YYYY-MM-DD'|null,                          // 범위를 고른 회차 날짜 (KST)
             actor: Member|탈퇴자, createdAt, isNew: boolean }
```

- 반복 일정 동작 하나는 로그 1건. `title`, `startsAt`, `endsAt`, `allDay` 스냅샷은 그 회차 값 ("이후 모두" 수정은 새 원본의 첫 회차). 문구는 웹이 `action` + `scope` + `repeat` + `occurrence` 로 조합 (반복-일정.md 4-3)
- 반복 일정 항목을 누르면 `/events/<eventCode>/edit?occurrence=` 로 이동 (#311)

- items = 그 팀 EventLog 중 `actorId != 요청자` (탈퇴자 null 포함), 최근 30일, createdAt 내림차순, 최대 50건
- (#297, D-180) 내가 팀에 들어오기 전 기록은 뺀다: `createdAt >= max(지금 - 30일, me.joinedAt)`. 두 소스(일정 기록, 팀 활동 기록) 모두 같은 기준. 다시 들어오면 멤버십을 새로 만들어 `joinedAt` 이 다시 들어온 시각이 된다
- `isNew` = `createdAt > me.lastSeenAt`. 화면은 목록을 받은 뒤 `seen` 을 호출한다 (순서 고정: GET → POST)
- `eventId` 가 null 이거나 action 이 DELETED 면 탭해도 일정으로 이동하지 않는다

#### 팀 활동 기록 (#191, D-150 ~ D-156, 기획 `새-소식-확장.md`)

`v=2` 일 때만 일정 기록(EventLog)과 팀 활동 기록(GroupActivity)을 합친다. `v` 가 없거나 다른 값이면 위 응답 그대로 (옛 웹 보호, D-155)

```ts
EventNewsItem    = { kind: 'EVENT' } & NewsItem          // 일정 항목 모양은 그대로
ActivityNewsItem = { kind: 'ACTIVITY', id: number,
  type: 'ANNIVERSARY_CREATED'|'ANNIVERSARY_UPDATED'|'ANNIVERSARY_DELETED'
      | 'MEMBER_JOINED'|'MEMBER_LEFT'|'MEMBER_DELETED'|'GROUP_RENAMED'
      | 'EVENTS_IMPORTED'           // (#279)
      | 'EVENT_RSVP',               // (#190)
      | 'POLL_CREATED'|'POLL_CLOSED',  // (#189)
  actor: Member,                 // D-152: 지금 멤버 / 나간 사람은 스냅샷 이름 + 회색 / 탈퇴는 MEMBER_DELETED 만 스냅샷 이름
  anniversaryId: number|null,    // 기념일 3종의 대상. 기념일이 지워지면 null
  payload: ActivityPayload, createdAt, isNew }
ActivityPayload =
  | { name, date: 'YYYY-MM-DD', kind: AnniversaryKind,          // 기념일 3종: 바뀐 뒤 값 (삭제는 삭제 전 값)
      changed?: ('name'|'date'|'kind')[], before?: { name?, date?, kind? } }   // 수정만: 바뀐 필드와 그 이전 값
  | { from: string, to: string }                                // GROUP_RENAMED
  | { count: number }                                           // EVENTS_IMPORTED (#279)
  | { eventId, eventCode, occurrence: 'YYYY-MM-DD'|null, title, startsAt, endsAt, allDay, status: Rsvp }   // EVENT_RSVP (#190). occurrence 는 반복 회차만
  | { pollId, code, title }                                     // POLL_CREATED (#189)
  | { pollId, code, title, eventId, eventCode, eventLogId, startsAt, endsAt, allDay }   // POLL_CLOSED (#189). 정한 후보
  | {}                                                           // 멤버 3종
```

| 종류 | 남기는 곳 (같은 트랜잭션) | 남기지 않는 경우 |
|------|--------------------------|-----------------|
| ANNIVERSARY_CREATED | `POST /groups/:id/anniversaries` | 같은 사람이 60초 안에 지운 기념일을 같은 이름, 날짜, 종류로 다시 추가 → 그 DELETED 기록을 지우고 CREATED 도 없음 (되돌리기, D-153) |
| ANNIVERSARY_UPDATED | `PATCH .../anniversaries/:id` | 이름, 날짜, 종류가 하나도 안 바뀜 (알림 시점만 바꿈 포함, #62 규칙) |
| ANNIVERSARY_DELETED | `DELETE .../anniversaries/:id` | - |
| MEMBER_JOINED | `POST /groups/join`, (#274) `POST /event-shares/:token/join` 이 새 멤버십을 만들 때. 일정 링크면 payload `{ via: 'EVENT_SHARE' }` | 이미 멤버 (멱등 재호출) |
| MEMBER_LEFT | `DELETE /groups/:id/me` (2.7) | 마지막 멤버라 팀이 지워짐 |
| MEMBER_DELETED | `DELETE /me` 의 TEAM 멤버십마다 (2.7) | 마지막 멤버라 팀이 지워짐 |
| GROUP_RENAMED | `PATCH /groups/:id` | 같은 이름 |
| EVENTS_IMPORTED (#279) | `POST /groups/:id/imports` 끝 (2.9) | 넣은 일정 0개 |
| EVENT_RSVP (#190) | `PUT .../events/:eventId/rsvp` 로 정하거나 바꿈 | 같은 값. 같은 사람이 같은 회차를 2분 안에 다시 바꾸면 새 줄 대신 그 줄을 고친다(시각도 지금으로). 취소(null)는 2분 안 줄만 지우고 새 줄은 없다 (D-227). 반응은 남기지 않는다 |
| POLL_CREATED (#189) | `POST /groups/:id/polls` | 취소(`DELETE .../polls/:id`)하면 그 기록도 지운다 |
| POLL_CLOSED (#189) | `POST .../polls/:id/confirm` | - . 이 확정으로 생긴 EventLog CREATED(payload `eventLogId`)는 v2 목록에서 숨기고 `unreadNewsCount` 에서도 뺀다 (D-236) |

- 조회: 두 테이블에서 각각 `actorId != 요청자` (null 포함), 최근 30일, 최신 50건을 읽어 합친 뒤 `createdAt` 내림차순 50건. 같은 시각이면 일정 먼저, 같은 종류는 id 내림차순 (D-151)
- 웹 키는 `${kind}:${id}` (두 테이블 id 가 겹친다). 웹은 모르는 `kind`, `type` 을 거른다 (뒤의 #190, #189 종류)
- `GroupSummary.unreadNewsCount` = EventLog 미확인 수 + GroupActivity 미확인 수 (`v` 와 무관, D-154). 미확인 = `createdAt > max(lastSeenAt, joinedAt)` (#297, D-180)
- 기록 생성은 서버만. 오류 코드 추가 없음, `POST /news/seen` 그대로. 푸시 변화 없음 (합류 푸시 D-91 은 따로)

### 2.7 나가기 / 탈퇴 처리 순서

**DELETE /groups/:groupId/me (팀 나가기)** — 한 트랜잭션

```
1. 멤버십 확인. group.type == PERSONAL 이면 GROUP_PERSONAL_LEAVE
2. 멤버십 삭제. 일정/기념일/로그는 그대로 (creatorId, actorId 유지 → 여전히 그 사람 이름으로 보임)
   (#191) 팀이 남으면 GroupActivity MEMBER_LEFT 한 줄 (actorName = 지운 멤버십의 표시 이름 ?? 닉네임, D-152)
   (#274) 내가 이 팀에서 만든 살아 있는 일정 공유 링크를 끊는다 (revokedAt = 지금, D-183)
   (#300) 내가 이 팀을 처음 여는 달력으로 고정했으면(User.startGroupId = 이 팀) LAST 로 되돌린다 (D-192)
   (#193) 내 이 팀 구독 주소(CalendarFeed)를 지운다 (D-217)
   (#190) 그 팀 일정의 내 참석 여부(EventRsvp), 반응(EventReaction) 삭제
   (#248) 이어서 그 팀 일정의 내 참여자 행 삭제 (EventParticipant where userId = 나, event.groupId = 이 팀). 0 이 된 일정은 "참여자 없음".
   로그, 새 소식, 알림 없음. 다시 합류해도 복구하지 않는다 (D-139)
   (#189) 그 팀 약속 투표의 내 표(PollVote)와 대상 행(PollParticipant)도 지운다. 기록 없음
3. 남은 멤버 0 이면 이 팀을 고정한 사용자 전부 LAST 로 되돌리고(#300) Group 삭제 (Cascade 로 일정/기념일/로그/멤버십 전부) → groupDeleted: true
```

**DELETE /me (회원 탈퇴)**

```
1. 카카오 unlink: POST https://kapi.kakao.com/v1/user/unlink
   Authorization: KakaoAK ${KAKAO_ADMIN_KEY}, body target_id_type=user_id&target_id=<AuthAccount.providerUserId>
   실패(이미 끊긴 경우 제외) → 502 KAKAO_ERROR, DB 는 건드리지 않음 (사용자가 다시 시도)
   애플 계정이면 Apple /auth/revoke (앱.md 3.5). 실패 → 502 APPLE_ERROR, DB 그대로
2. 트랜잭션:
   a. 내 PERSONAL 팀 삭제 (Cascade)
   b. 내 TEAM 멤버십 각각에 대해 2.7 나가기 2~3 단계 (마지막 멤버였던 팀은 삭제).
      (#191) 남는 팀에는 MEMBER_LEFT 대신 MEMBER_DELETED 한 줄. User 삭제 전에 넣고 d 에서 actorId 가 SetNull 이 된다
   c. (#245) 내 EMAIL 계정 이메일의 EmailLoginChallenge 전부 삭제 (이메일 계정은 1단계 unlink 할 일 없음)
   d. User 삭제 → 남은 Event.creatorId / Anniversary.creatorId / EventLog.actorId / GroupActivity.actorId 는 FK SetNull → "탈퇴한 멤버"
      (#248) 남은 EventParticipant 행은 User Cascade 로 삭제
      (#190) 남은 EventRsvp, EventReaction 행도 User Cascade 로 삭제
3. 웹은 응답을 받으면 쿠키를 지우고 /login 으로
```

### 2.8 푸시 (#188)

설계 근거는 `푸시-알림.md` (D-80 ~ D-99). 그 문서가 원본이고 이 절은 구현된 엔드포인트와 필드만 적는다.

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| PUT | `/me/push-devices` | 유저 | `{ token, platform: 'IOS'\|'ANDROID', appVersion: string(1~20) }` | `{ data: { ok: true } }`. token 으로 upsert (`userId = 나`, `lastSeenAt = now`). 다른 사용자 행이면 나로 옮긴다 (한 기기는 한 사용자). 내 기기가 10대를 넘으면 `lastSeenAt` 이 가장 오래된 것부터 삭제 |
| DELETE | `/me/push-devices` | 유저 | `{ token }` (본문) | `{ data: { ok: true } }`. `token` 이고 `userId = 나` 인 행만 삭제. 없어도 200 (멱등). 웹 로그아웃 route handler, OS 에서 알림을 끈 기기 정리가 부른다 |
| GET | `/me/notification-settings` | 유저 | - | `{ data: NotificationSettings }` |
| PATCH | `/me/notification-settings` | 유저 | `Partial<NotificationSettings>` | `{ data: NotificationSettings }`. 준 키만 저장, 빈 본문은 그대로. (#369) 저장은 `NotificationPreference(userId, kind)` 행(준 키는 기본값과 같아도 행으로 남김), 행이 없는 키는 기본값(`weeklyNudge` 만 끔). 응답 모양은 그대로 (D-249) |

```ts
NotificationSettings = { reminder: boolean, change: boolean, anniversary: boolean, join: boolean,   // 기본 true
                         weekly: boolean,        // (#277) 주간 요약, 기본 true
                         weeklyNudge: boolean,   // (#277) 다 같이 비는 시간(조용한 팀 깨우기), 기본 false (D-204)
                         poll: boolean }         // (#189) 약속 투표(열림, 마감, 정함), 기본 true
EventReminder = 'NONE'|'AT_START'|'MIN_10'|'HOUR_1'|'DAY_1'|'DAY_OF_0900'|'DAY_BEFORE_0900'
```

- `token` 은 `^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,180}\]$`. 아니면 400 VALIDATION_FAILED (`field: 'token'`). `platform` 이 둘 외, `appVersion` 이 1~20자가 아니면 400. 설정 값이 불리언이 아니면 400 (`field` = 그 키). 새 오류 코드 없음
- 탈퇴(`DELETE /me`) 는 User Cascade 로 기기와 발송 기록을 함께 지운다 (D-99)

**일정 `reminder`** (2.3 `EventInput`, `Event`):

| 값 | 쓸 수 있는 일정 | 알림 시각 (회차 시작 `s`) |
|----|----------------|------|
| `NONE` | 모두 | - |
| `AT_START`, `MIN_10`, `HOUR_1`, `DAY_1` | 시간 일정 | `s`, `s - 10분`, `s - 1시간`, `s - 24시간` |
| `DAY_OF_0900`, `DAY_BEFORE_0900` | 종일 일정 | `s` 의 KST 날짜 09:00, 그 전날 09:00 |

- 종일 여부와 안 맞는 값을 보내면 400 VALIDATION_FAILED (`field: 'reminder'`, "종일 일정에는 고를 수 없는 알림이에요" / "시간 일정에는 고를 수 없는 알림이에요"). 수정은 합친 결과로 검사하고, 본문에 `reminder` 없이 `allDay` 가 바뀌어 지금 값이 안 맞게 되면 `NONE` 으로 바꾼다
- 반복 "이 일정만" 은 그 회차 예외에 저장 (원본 값과 같으면 예외에 두지 않음). "이후 모두" 는 원본(새 원본) 값. 응답 `reminder` 는 그 회차의 실제 값
- 같은 값이면 저장하지 않는 규칙(#62) 에 `reminder` 도 들어간다. 알림만 바꿔도 UPDATED 로그가 남는다
- 서버 저장: 한 번짜리는 `Event.remindAt` (알림 시각), 반복 원본은 null. 시작, 끝, 종일, 알림, 반복, 반복 종료일이 바뀌면 `reminderSetAt = now` 이고, 알림 시각이 이 값보다 앞이면 보내지 않는다 (D-86)

**일정 알림 받는 사람** (#248, D-138): 펼치는 순간 그 일정(반복이면 원본)의 참여자 ∩ (설정 `REMINDER` AND `Membership.notify`, #369 NotificationPreference). "모두" 면 팀원 전원, 참여자 없음이면 0명으로 DISPATCHED. 팀원 변경, 기념일, 합류 알림은 그대로 팀 전체

**생일 알림** (#305, D-232): 기념일 알림과 같은 틱, 같은 시각(오전 9시 KST)과 문구 모양("민지 생일", "오늘은 민지 생일이에요"), `kind: ANNIVERSARY`. 시점은 생일인 사람이 `PATCH /me/birthday reminders` 로 고른다(기본 당일만). 생일을 보이는 TEAM 팀마다 1건(개인 팀 없음), `dedupeKey` `B:{userId}:{groupId}:{그날}{:D1|:D7}`, `actorId` = 생일인 사람이라 받는 사람에서 빠진다. 펼칠 때 그 사람이 아직 그 팀에 생일을 보이고 생일이 그날이 맞는지 다시 보고, 아니면 SKIPPED. 받는 사람 조건은 기념일과 같다(설정 `ANNIVERSARY` AND `Membership.notify`)

**들어오기 전 일** (#297, D-180): 팀원 변경(CHANGE, 가져오기 포함)과 합류(JOIN) 알림은 그 예약을 만든 시각(`PushNotification.createdAt`)까지 들어와 있던 팀원(`joinedAt <= createdAt`)에게만. 일정 알림, 기념일 알림은 펼칠 때 팀원이면 받는다

**발송** (서버 내부, 엔드포인트 없음): `PUSH_ENABLED=1` 이면 API 프로세스 안 30초 틱이 `SchedulerLease` 임대를 얻은 프로세스에서만 일정 알림, 기념일(당일, 하루 전, 일주일 전), 팀원 변경(2분 묶음), 합류 알림을 예약하고 Expo 로 보낸다. 규칙은 `푸시-알림.md` 5, 6장, 운영은 `docs/운영/푸시.md`

| 환경 변수 | 필수 | 용도 |
|-----------|------|------|
| `PUSH_ENABLED` | 아니오 | `1` 이면 틱을 돈다. 없으면 예약 행만 쌓이고 보내지 않는다 (켜면 10분 넘게 지난 것은 SKIPPED) |
| `EXPO_ACCESS_TOKEN` | 아니오 (운영 권장) | Expo 액세스 토큰. 있으면 `Authorization: Bearer` (D-94) |
| `EXPO_PUSH_URL` | 아니오 | 기본 `https://exp.host/--/api/v2/push`. e2e 가 가짜 서버 주소를 넣는다 |

### 2.9 일정 가져오기 (#279, 설계 `일정-가져오기.md`, D-160 ~ D-167)

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| POST | `/groups/:groupId/imports/preview` | 멤버 | multipart `file` (.ics, 2MB), `range?: 'future'\|'year'\|'all'` (기본 future. all 은 #314, 파일 전체) | 200 `{ data: ImportPreview }`. 아무것도 저장하지 않는다 |
| POST | `/groups/:groupId/imports` | 멤버 | multipart `file`, `range?`, `participants?: 'ALL'\|'ME'` (기본 TEAM 은 ALL, PERSONAL 은 ME), `include?` (#314, 아래) | 201 `{ data: { importId: number\|null, created, skipped: SkipCount[] } }`. 넣은 게 0이면 importId null |

```ts
SkipReason   = 'DUPLICATE'|'CANCELLED'|'TOO_OLD'|'TOO_LONG'|'INVALID'|'OVER_LIMIT'
SkipCount    = { reason: SkipReason, count: number }        // 0 인 이유는 뺀다, 위 순서
ImportPreview = { total: number,          // 파일 안 VEVENT 수
                  toCreate: number,       // 넣을 일정 (반복으로 옮긴 것 1개, 펼친 회차 각각). 최대 1,000
                  recurringKept: number, expanded: number, expandedSeries: number,
                  skipped: SkipCount[], firstStartsAt: ISO|null, lastStartsAt: ISO|null,
                  warnings: ('UNKNOWN_TZID'|'TRUNCATED_TITLE')[],
                  sample: { title, startsAt, endsAt, allDay, repeat }[],   // 시작 순 앞 5개 (옛 웹용)
                  items: ImportItem[] }                                     // (#314) 넣을 일정 전부, 시작 순, 최대 1,000
ImportItem   = { key: string,            // 64자 hex. 중복 방지 해시(uidHash)와 같은 값
                 title, startsAt, endsAt, allDay, repeat }
```

- (#314, D-194) `include`: 넣을 `items[].key` 의 **JSON 문자열 배열** (multipart 텍스트 필드 하나, 예 `'["ab12…", …]'`). 생략하면 전부. `[]` 는 400 VALIDATION_FAILED `field: 'include'` "넣을 일정을 하나 이상 골라 주세요". JSON 배열이 아니거나 64자 소문자 hex 가 아닌 값, 1,000개 초과도 400 (`field: 'include'`). 이번 파일의 넣을 일정에 없는 키는 무시(모두 없으면 0개, importId null). 뺀 일정은 skipped 에 세지 않고 기록하지 않아 다음에 같은 파일을 올리면 다시 넣을 일정으로 나온다. 미리보기는 include 를 받지 않는다(400)

- 파일은 저장하지 않는다. 미리보기와 넣기에서 두 번 올린다 (서버 상태 없음). 넣기는 같은 계산을 다시 한다
- 오류: 파일 없음, 못 읽음, 2MB 초과, 다른 이름의 파일 필드 → 400 VALIDATION_FAILED `field: 'file'` ("캘린더 파일(.ics)을 읽지 못했어요" / "파일이 너무 커요. 2MB 까지 올릴 수 있어요"). VEVENT 3,000개 초과 → 400 IMPORT_TOO_LARGE. range, participants 형식, 모르는 필드 → 400. 멤버 아님 403. 중간 실패 500 IMPORT_INCOMPLETE
- 1,000개를 넘으면 오류가 아니라 시작 순 1,000개만 넣고 나머지는 OVER_LIMIT (같은 파일을 다시 올리면 다음 묶음)
- 중복: (팀, 원본 키 해시) 가 이미 있으면 DUPLICATE. 일정을 지워도 다시 들어가지 않고, 바뀐 내용으로 덮어쓰지 않는다
- 넣은 일정: 등록자 = 요청자, 알림 NONE, EventLog 없음. 끝나면 GroupActivity `EVENTS_IMPORTED { count }` 한 줄 + TEAM 이면 팀원 변경 푸시 한 건 (dedupeKey `I:{importId}`)

### 2.10 일정 카드 공유 (#274, D-181 ~ D-186)

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/events/:eventId/share` | 멤버 | 쿼리 `occurrence?` | `{ data: EventShareLink \| null }` 그 일정(회차)의 살아 있는 링크 |
| POST | `/groups/:groupId/events/:eventId/share` | 멤버 | `{ occurrence? }` | 201 새로 만듦, 200 기존 반환. `{ data: EventShareLink }`. PERSONAL 팀 GROUP_NOT_INVITABLE, 끝난 회차 EVENT_SHARE_ENDED |
| DELETE | `/groups/:groupId/events/:eventId/share` | 멤버 | 쿼리 `occurrence?` | `{ data: { ok: true } }` 살아 있는 링크를 끊는다(없어도 200). 팀원 누구나 |
| GET | `/event-shares/:token` | 선택 | - | `{ data: EventSharePreview }`. 토큰이 없거나 틀리거나 만료돼도 401 이 아니라 익명 (D-158 과 같은 선택 인증) |
| POST | `/event-shares/:token/join` | 유저 | - | `{ data: { group: GroupDetail, eventId, eventCode, occurrence, date } }`. 멱등(이미 멤버면 그대로 200). (#311) `eventCode` 와 `group.publicCode` 로 `/events/<eventCode>?team=<groupCode>` 에 착지 |

```ts
EventShareLink    = { token, url, expiresAt }       // url = `${WEB_ORIGIN}/join/e/${token}`, token = 16바이트 base64url 22자
EventSharePreview = { groupName, memberCount,
                      sharer: { displayName } | null,  // 만든 사람의 팀 표시 이름 ?? 닉네임. 팀에 없으면 null. 사진 없음
                      event: { title, startsAt, endsAt, allDay, repeat, occurrence, color },  // 그 회차의 지금 값(예외 반영, 스냅샷 아님). (#343) color = 일정 색, null 이면 자동
                      expiresAt,
                      viewer: { member: true, groupId, eventId, groupCode, eventCode, occurrence, date } | { member: false } }  // 유효한 토큰 + 멤버일 때만 id 와 (#311) 공개 코드
```

- `occurrence` 는 반복 일정에서 필수(`YYYY-MM-DD`, 실제 회차가 아니거나 취소된 회차면 400 VALIDATION_FAILED), 한 번짜리에서는 무시
- 같은 일정(회차)에 살아 있는 링크는 팀 전체에 하나. 살아 있는 링크 = `revokedAt IS NULL AND expiresAt > now`. 만들기는 일정 행을 잠가 동시 요청에도 하나만 생긴다
- 만료 = 그 회차 `endsAt` + 1일, 단 만든 때 + 30일을 넘지 않음. 정리 작업 없음 (행이 남아도 404)
- 끊김: DELETE, 초대 코드 재발급(그 팀 전부), 만든 사람의 나가기/탈퇴(그 사람 것), 일정 삭제(Cascade). 미리보기 때 회차가 취소됐거나 "이후 모두" 로 옛 원본에 더는 없으면 404
- 비멤버 응답에는 메모, 참여자, 등록자, 프로필 사진, groupId, eventId 가 없다
- `date` 는 그 회차가 지금 시작하는 KST 날짜 ("이 일정만" 으로 옮겼으면 옮긴 날). 웹은 `/events/<eventCode>?team=<groupCode>[&occurrence=]` 로 간다 (#311)
- 합류는 `POST /groups/join` 과 같은 내부 함수(`GroupsService.joinGroup`: 색 배정, JOIN 알림, 새 소식). 새로 합류하면 `joinCount + 1` 과 새 소식 `MEMBER_JOINED { via: 'EVENT_SHARE' }` (D-185)
- 토큰 대조는 대소문자를 구분한다 (열 정렬은 ci 라 서비스가 다시 맞춘다). Sentry 는 `/join/e/<token>`, `/event-shares/<token>` 경로를 지운다

### 2.11 할 일 목록 (#276, 설계 `할일-목록.md`, D-206 ~ D-210)

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/todo-lists` | 멤버 | - | `{ data: { items: TodoListSummary[] } }` updatedAt 내림차순 |
| POST | `/groups/:groupId/todo-lists` | 멤버 | `{ name(1~30) }` | 201 `{ data: TodoList }`. 팀에 20개면 TODO_LIMIT_REACHED |
| GET | `/todo-lists/:code` | 유저 | - | `{ data: { list: TodoList, items: TodoItem[] } }`. 틀린 코드, 없는 목록, 비멤버 모두 404 NOT_FOUND |
| PATCH | `/groups/:groupId/todo-lists/:listId` | 멤버 | `{ name(1~30) }` | `{ data: TodoList }` |
| DELETE | `/groups/:groupId/todo-lists/:listId` | 멤버 | - | `{ data: { ok: true } }` 항목 Cascade |
| POST | `/groups/:groupId/todo-lists/:listId/items` | 멤버 | `{ text(1~100), done? }` | 201 `{ data: TodoItem }`. 목록에 300개면 TODO_LIMIT_REACHED |
| DELETE | `/groups/:groupId/todo-lists/:listId/items?done=true` | 멤버 | - | `{ data: { ok: true, count } }` 완료 항목 지우기. `done=true` 가 없으면 400 VALIDATION_FAILED |
| PATCH | `/groups/:groupId/todo-items/:itemId` | 멤버 | `{ text?(1~100), done? }` | `{ data: TodoItem }`. 같은 값은 쓰지 않는다(멱등) |
| DELETE | `/groups/:groupId/todo-items/:itemId` | 멤버 | - | `{ data: { ok: true } }` |

```ts
TodoListSummary = { id, publicCode, name, openCount, doneCount, editor: Member, updatedAt }
TodoList        = { id, publicCode, groupId, groupCode, name, creator: Member|탈퇴자, editor: Member|탈퇴자, createdAt, updatedAt }
TodoItem        = { id, listId, text, done, doneAt: string | null, doneBy: Member|탈퇴자|null, creator: Member|탈퇴자, createdAt, updatedAt }
```

- 항목 순서: 미완료 createdAt 오름차순, 그 아래 완료 doneAt 내림차순
- `done: true` 는 doneAt = 지금, doneBy = 나, `false` 는 둘 다 null. 목록 updatedAt, editor 는 목록과 항목이 실제로 바뀔 때마다 올린다
- 새 소식, 푸시 기록 없음. 요청 제한은 기본 한도만 (D-210)

### 2.12 외부 캘린더 구독 (#193, 설계 `캘린더-내보내기.md`, D-217 ~ D-221)

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/calendar-feed` | 멤버 | - | `{ data: CalendarFeed \| null }` 내 주소 (없으면 null) |
| PUT | `/groups/:groupId/calendar-feed` | 멤버 | `{ includeMemo?: boolean, includeAnniversaries?: boolean }` | `{ data: CalendarFeed }` 없으면 만들고(메모 끔, 기념일 켬) 있으면 설정만 바꾼다(주소 유지) |
| POST | `/groups/:groupId/calendar-feed/rotate` | 멤버 | - | `{ data: CalendarFeed }` 새 주소, 이전 주소는 즉시 404. 주소가 없으면 404 NOT_FOUND ("연결 주소가 없어요") |
| DELETE | `/groups/:groupId/calendar-feed` | 멤버 | - | `{ data: { ok: true } }` 끄기(행 삭제). 없어도 200 |
| GET | `/ics/:token.ics` | 없음 | 헤더 `If-None-Match?` | `200 text/calendar; charset=utf-8` VCALENDAR (봉투 없음) / 304 / 404, 429 본문 없음 |

```ts
CalendarFeed = { httpsUrl,        // `${API_PUBLIC_ORIGIN}/v1/ics/<토큰 43자>.ics`
                 webcalUrl,       // httpsUrl 의 스킴을 webcal: 로
                 googleAddUrl,    // `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}` (컴퓨터 웹에서만 동작)
                 includeMemo, includeAnniversaries, createdAt,
                 lastFetchedAt: string | null }  // 외부 캘린더가 마지막으로 가져간 시각 (1분 단위)
```

- (사용자, 팀) 하나에 주소 하나. 개인 팀도 된다. 토큰은 DB 에 없고 소금과 해시만 있다(D-218). 다시 조회해도 같은 주소
- 피드 404 는 형식 오류, 없는 토큰, 재발급 전 토큰, 끈 주소, 나간 팀, 탈퇴, 지운 팀을 구분하지 않는다. 멤버십은 요청마다 확인
- 피드 내용: 오늘(KST) 기준 과거 60일 ~ 미래 400일의 그 팀 일정(반복은 회차마다 VEVENT, 예외 반영, 취소 회차 없음), `includeAnniversaries` 면 기념일 항목과 (#305, D-233) 이 팀에 보이는 멤버 생일(그해 그날 종일 VEVENT "민지 생일", UID `b{userId}-{YYYYMMDD}@whenwemeet.day`, 투명). 매핑은 설계 3장
- `ETag` = 본문 해시, `Cache-Control: private, max-age=900`. 피드 조회는 새 소식, 푸시, 활동 기록과 무관하다. 만들기, 재발급도 기록하지 않는다
- 설정 API 오류는 기존 코드(VALIDATION_FAILED, FORBIDDEN, NOT_FOUND). 새 오류 코드 없음. 사용자에게 보이는 message 에는 "구독" 대신 "연결 주소" (D-221)
- Sentry 는 `/ics/<토큰>` 경로를 지운다

### 2.13 약속 투표 (#189, 설계 `약속-투표.md`, D-234 ~ D-241)

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/groups/:groupId/polls` | 멤버 | `?status=open\|closed` (기본 open) | `{ data: PollSummary[] }`. 진행 중은 고를 후보가 남은 것 먼저, 마감 가까운 순(없음 뒤), 최근 연 순. 닫힌 것은 최근 30일 |
| POST | `/groups/:groupId/polls` | 멤버 | `PollInput` | 201 `{ data: Poll }` + GroupActivity POLL_CREATED + 열림 알림 |
| GET | `/polls/:code` | 멤버 | - | `{ data: Poll }`. 틀린 코드, 없는 투표, 비멤버 모두 404 |
| PUT | `/groups/:groupId/polls/:pollId/votes` | 멤버 (대상) | `{ optionIds: number[] }` 내 "가능" 전체 (`[]` = 다 해제) | `{ data: Poll }` |
| POST | `/groups/:groupId/polls/:pollId/confirm` | 멤버 | `{ optionId }` | 201 `{ data: { poll: Poll, event: Event, warning: 'BUSY_NOW'\|null } }` |
| DELETE | `/groups/:groupId/polls/:pollId` | 멤버 | - | `{ data: { ok: true } }` 진행 중만 |

```ts
PollInput   = { title: string(1~50), options: { startsAt: ISO, endsAt: ISO, allDay: boolean }[] /* 2~5 */,
                deadline?: ISO|null, participants?: 'ALL'|number[] /* 생략 = 'ALL' */ }
Poll        = { id, publicCode, groupId, groupCode, title, status: 'OPEN'|'CLOSED', deadline: ISO|null, expired: boolean,
                creator: Member|탈퇴자, createdAt, closedAt, eventId: number|null, eventCode: string|null, decidedOptionId: number|null,
                participants: { all: boolean, members: Member[] },
                options: { id, startsAt, endsAt, allDay, past: boolean, voters: Member[] }[], myVotes: number[], canVote: boolean }
PollSummary = { id, publicCode, title, status, deadline, expired, eventId, eventCode, voterCount, targetCount, votedByMe, allPast, createdAt, closedAt }
```

- 검증 400 VALIDATION_FAILED: 개인 팀(field `groupId`), 제목, 후보 2~5개가 아님, 끝 <= 시작, 30일 초과, 지난 시작, 같은 구간 중복, 종일 후보가 KST 00:00 경계가 아님(field `options`), 지난 마감(`deadline`), 참여자 형식과 멤버(`participants`, 일정과 같은 규칙), 진행 중 10개 초과("진행 중인 투표가 너무 많아요"), 남의 후보(`optionIds`, `optionId`)
- `expired` 는 읽을 때 계산 (`OPEN AND deadline <= now`). 마감 뒤 표는 409, 정하기는 된다 (D-235)
- 지난 후보는 새로 켜거나 정하면 400 POLL_OPTION_PAST, 이미 켜 둔 표는 빠져도 남긴다 (D-238)
- 정하기는 한 트랜잭션(일정 + CREATED 로그 + CLOSED + POLL_CLOSED + 정함 알림), 동시에 누르면 하나만 성공하고 나머지 409. 팀원 변경 알림 없음. 바빠진 대상이 있으면 `warning: 'BUSY_NOW'` (D-239)
- 나가기: 그 팀 투표의 내 표와 대상 행 삭제(2.7). 탈퇴: Cascade

### 2.14 장소 검색 (#199, D-247, D-259)

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/places/search` | 유저 | 쿼리 `q` (앞뒤 공백 자르고 1~50자), `provider` (`kakao` 기본, `naver`. 다른 값은 400 field `provider`) | `{ data: { items: PlaceCandidate[] } }` |
| GET | `/places/resolve` | 유저 | 쿼리 `provider` (위와 같음), `id` (카카오 장소 ID, 네이버면 `naverKey`), `q` (저장된 검색어, 1~100자) | `{ data: { place: PlaceCandidate \| null } }` 그 출처에서 그 검색어로 다시 찾아 식별자가 같은 결과. 없으면 null |

```ts
PlaceCandidate = { provider: 'kakao'|'naver',
                   kakaoPlaceId: string|null, naverKey: string|null,           // 출처에 맞는 하나만 있다
                   name: string, address: string|null,                          // 도로명, 없으면 지번
                   lat: number, lng: number, category: string|null }             // 분류 마지막 조각 ("카페", 네이버 "숲,숲길")
```

- 카카오: 우리 API 가 카카오 로컬 키워드 검색(`GET https://dapi.kakao.com/v2/local/search/keyword.json?query=&size=15`, `Authorization: KakaoAK <KAKAO_REST_API_KEY>`)을 대신 부른다. REST 키는 서버에만 둔다(로그인과 다른 지도 전용 카카오 앱 키)
- 네이버 (D-259): NAVER API HUB 지역 검색 `GET https://naverapihub.apigw.ntruss.com/search/v1/local?query=&display=5&start=1&sort=random`, 헤더 `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY` (`NAVER_SEARCH_CLIENT_ID`, `NAVER_SEARCH_CLIENT_SECRET`, 서버에만). 결과는 최대 5개(네이버 제한), 하루 25,000회 상한(넘으면 네이버가 4xx, 우리는 502). 정규화: `title` 은 `<b>` 태그를 지우고 HTML 엔티티를 되돌린다, `mapx/1e7` = 경도, `mapy/1e7` = 위도(WGS84), 주소는 `roadAddress`, 없으면 `address`, `naverKey` 는 이름 + 주소 해시(2.3 장소). 이름 + 주소가 같은 항목은 하나만
- 공통: 검색어 말고 사용자 정보는 보내지 않는다. 결과는 DB 에 저장하지 않고 (출처, 검색어)별 5분 메모리 캐시(최대 500개)만, 로그에 검색어를 남기지 않는다
- 공급자: 그 출처의 키가 있으면 실제 검색, 없으면 운영은 503 `PLACE_SEARCH_NOT_CONFIGURED`(웹은 직접 입력만), 로컬과 테스트는 가짜 목록. `PLACE_SEARCH_FAKE=1` 이면 둘 다 늘 가짜
- 검색 실패(연결, 5초 시간 초과, 4xx/5xx, 형식)는 502 `PLACE_SEARCH_FAILED`. 재시도 없음
- 요청 제한: 검색 사용자당 분당 60회 (`placeSearch`), 다시 찾기 분당 120회 (`placeResolve`). 출처와 상관없이 같은 묶음
- 웹은 내 정보의 지도 선택(네이버 지도 기본, D-258)으로 `provider` 를 고른다. `provider` 가 없는 옛 웹은 카카오

### 2.15 AI 비서 "볼까" (#450, 설계 `AI-비서.md`, D-264 ~ D-275, (#511) D-283)

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| POST | `/me/assistant-consent` | 유저 | - | `{ data: { consentedAt } }`. 멱등(이미 했으면 처음 값) |
| POST | `/groups/:groupId/assistant/messages` | 멤버 | `AssistantRequest` | `{ data: AssistantReply }` |

```ts
AssistantRequest = { text: string(1~300), history?: { role: 'user'|'assistant', text: string(1~600) }[] /* ≤10, 합계 ≤4,000자 */ }
AssistantReply   = { reply: string, cards: AssistantCard[] /* 0~5. 일정 초안은 한 글의 일정마다 1장(최대 5장, #474), 그 밖 0~2 */, historyText: string /* ≤600 */, usage: { used, limit } }
AssistantCard    = eventDraft | eventEditDraft | eventDeleteDraft | eventChoice | freeSlots | pollDraft | eventList | clarify | unsupported | refusal   // 모양은 AI-비서.md 2장
```

- 서버는 아무것도 쓰지 않는다(일정, 투표, 새 소식, 알림 없음). 카드의 저장은 웹이 2.3 `POST /events`, 2.13 `POST /polls` 로 한다
- (#511, D-283) "금요일 회식 7시 반으로 바꿔줘", "내일 영화 취소해줘" 는 서버가 이 팀 일정(2.3 목록과 같은 권한, 반복은 회차로 펼침)에서 대상을 찾아 1개면 `eventEditDraft` / `eventDeleteDraft`, 여럿이면 `eventChoice`(앞 5개), 0개면 카드 없이 "그 일정을 찾지 못했어요. 날짜나 제목을 넣어 다시 말해 주세요". 반영은 웹이 기존 2.3 `PATCH`, `DELETE /groups/:id/events/:eventId` 로 하고, 반복 회차는 늘 `?occurrence=&scope=this`("이후 모두" 는 [고치기] 로 연 수정 화면에서). 삭제는 기존 되돌리기(`deletionId`, 7초 토스트)
- (#474, D-280) 한 글에 일정을 여럿 말하면("내일 저녁 7시 회식, 토요일 오후 2시 영화") `eventDraft` 카드가 말한 순서대로 여러 장(최대 5장) 온다. `reply` 는 1장이면 "이렇게 넣을까요?", N장이면 "일정 N개를 이렇게 넣을까요?". 하나라도 되물어야 하면 카드 없이 그 되묻기만(제목을 붙여 "'영화'는 언제로 할까요?"). 웹은 카드마다 [추가] 를 따로 한다
- OpenAI `gpt-4.1-mini`(D-278) 를 요청당 한 번(도구 호출 강제) 부르고 `reply` 는 항상 서버 문구 틀이다. 모델 글자는 내보내지 않는다 (D-267)
- 하루 30번(KST, 사용자 단위, `AssistantUsage`): 모델로 보낸 메시지는 거절이어도 센다. 503, 504, 500 은 되돌린다. 400, 403, 409, 분당 429 는 세지 않는다 (D-269)
- 오류: 400 VALIDATION_FAILED(`text`, `history`), 403, 409 ASSISTANT_CONSENT_REQUIRED, 429 RATE_LIMITED, 429 ASSISTANT_DAILY_LIMIT, 503 ASSISTANT_UNAVAILABLE, 504 ASSISTANT_TIMEOUT
- 대화, 답, 인자는 저장하지 않고 로그도 길이, 도구 이름, 결과 종류, 시간, 토큰 수만 (D-275)
- 웹은 카드에서 저장하는 `POST /events`, `POST /polls` 에 `X-Client-Source: assistant|assistant-poll|assistant-edit|assistant-edit-changed` 를 싣고, API 는 만들기 로그 줄에만 남긴다(동작 변화 없음). (#511) 고치기 카드 [수정] 의 `PATCH`, 지우기 카드 [삭제] 의 `DELETE` 에도 `assistant` 를 싣고 API 는 `event_update`, `event_delete` 로그 줄에만 남긴다

### 2.16 공지사항과 관리자 (#515, D-285, D-286, #528 D-287)

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| GET | `/notices` | 선택 | `limit?`(1~50, 기본 20), `cursor?` | `{ data: { items: NoticeListItem[], nextCursor } }` 게시된 것만, 고정 먼저 게시 시각 내림차순 |
| GET | `/notices/:id` | 선택 | - | `{ data: Notice }`. 초안은 관리자만, 그 밖은 404 NOT_FOUND |
| POST | `/notices/seen` | 유저 | - | `{ data: { noticesSeenAt } }`. 멱등이라 200. 화면은 목록을 받은 뒤 부른다 (GET → POST) |
| GET | `/admin/notices` | 관리자 | `limit?`, `cursor?` | `{ data: { items: Notice[], nextCursor } }` 초안 포함, id 내림차순 |
| GET | `/admin/notices/:id` | 관리자 | - | `{ data: Notice }` |
| POST | `/admin/notices` | 관리자 | `{ title(1~100), body(1~20000), kind, pinned?, published?, push? }` | 201 `{ data: Notice }`. `published: true` 면 지금 게시, 아니면 초안. (#528) `push: true` 는 `published: true` 일 때만(아니면 400 VALIDATION_FAILED `field: 'push'`), 전체 푸시를 예약한다 |
| PATCH | `/admin/notices/:id` | 관리자 | 같은 필드 모두 선택 | `{ data: Notice }`. `published: true` 는 초안일 때만 지금 게시(이미 게시면 시각 유지), `false` 는 게시 취소. (#528) `push: true` 는 고친 결과가 게시 상태일 때만(아니면 400 `field: 'push'`), 이미 보낸 공지면 409 NOTICE_ALREADY_PUSHED 이고 아무것도 바꾸지 않는다 |
| DELETE | `/admin/notices/:id` | 관리자 | - | `{ data: { ok: true } }` |
| GET | `/admin/users` | 관리자 | `q?`(닉네임 부분 일치, 50자), `limit?`, `cursor?` | `{ data: { items: AdminUser[], nextCursor } }` id 내림차순 |
| GET | `/admin/users/:id` | 관리자 | - | `{ data: { user: AdminUser, teams: AdminGroup[], notifications: AdminUserNotifications } }`. (#528) 알림 설정은 읽기 전용 |
| PATCH | `/admin/users/:id/role` | 관리자 | `{ role: 'user'\|'admin' }` | `{ data: AdminUser }`. 내 역할이면 403 FORBIDDEN "내 역할은 바꿀 수 없어요" |
| GET | `/admin/groups` | 관리자 | `q?`(팀 이름, (#528) 개인 달력은 주인 닉네임도), `type?`(`TEAM` \| `PERSONAL`, 없으면 전체, 그 밖 400), `limit?`, `cursor?` | `{ data: { items: AdminGroup[], nextCursor } }` |
| GET | `/admin/groups/:id` | 관리자 | - | `{ data: AdminGroupDetail }` |
| POST | `/admin/groups/:id/hide` | 관리자 | `{ reason(1~200) }` | `{ data: AdminGroupDetail }` |
| POST | `/admin/groups/:id/unhide` | 관리자 | - | `{ data: AdminGroupDetail }` |
| DELETE | `/admin/groups/:id` | 관리자 | - | `{ data: { ok: true } }` 모든 멤버에게서 삭제 |
| GET | `/admin/events` | 관리자 | `q?`(제목), `groupId?`, `limit?`, `cursor?` | `{ data: { items: AdminEvent[], nextCursor } }` 제목만 (메모, 장소 없음) |
| GET | `/admin/events/:id` | 관리자 | - | `{ data: AdminEvent & { memo, place } }` |
| POST | `/admin/events/:id/hide` | 관리자 | `{ reason(1~200) }` | `{ data: AdminEvent & { memo, place } }` |
| POST | `/admin/events/:id/unhide` | 관리자 | - | 같음 |
| DELETE | `/admin/events/:id` | 관리자 | - | `{ data: { ok: true } }` 반복이면 원본째 |
| GET | `/admin/logs` | 관리자 | `limit?`, `cursor?` | `{ data: { items: AdminAction[], nextCursor } }` 최근 것 먼저 |

```ts
NoticeKind     = 'notice' | 'update' | 'maintenance'
NoticeListItem = { id, title, kind: NoticeKind, pinned, publishedAt, unread: boolean }   // 본문 없음. 익명은 unread 늘 false
Notice         = { id, title, body, kind: NoticeKind, pinned, publishedAt: string | null, pushedAt: string | null, createdAt, updatedAt }   // publishedAt null = 초안. (#528) pushedAt null = 푸시 안 보냄
AdminUser      = { id, nickname, role: 'user' | 'admin', createdAt, providers: AuthProvider[] }
Hidden         = { reason, hiddenAt, hiddenBy: { id, nickname } | null }
AdminPerson    = { id, nickname, profileImageUrl: string | null }   // (#528)
AdminGroup     = { id, name, type, owner: AdminPerson | null /* (#528) 개인 달력의 주인, 팀은 null */, memberPreview: AdminPerson[] /* (#528) 먼저 들어온 3명까지 */, memberCount, eventCount, createdAt, hidden: Hidden | null }
AdminGroupDetail = AdminGroup & { members: { userId, nickname, displayName, joinedAt }[], recentEvents: { id, title, startsAt, allDay, repeat, hidden }[] /* 시작 내림차순 20 */ }
AdminEvent     = { id, title, group: { id, name, hidden, type, owner: AdminPerson | null /* (#528) */ }, startsAt, endsAt, allDay, repeat, creator: { id, nickname } | null, createdAt, hidden: Hidden | null }
AdminUserNotifications = { settings: NotificationSettings /* 내 정보 > 알림 과 같은 모양(푸시-알림.md 7-1), 공지 포함 */,
                           devices: { platform: 'IOS' | 'ANDROID', appVersion, createdAt, lastSeenAt }[] /* 토큰 없음, 마지막 확인 내림차순 */ }   // (#528)
AdminAction    = { id, action, targetType: 'notice' | 'user' | 'group' | 'event', targetId, reason: string | null, createdAt, admin: { id, nickname } | null }
```

- 인증 열 `선택` 은 토큰이 없거나 틀려도 익명으로 답한다(401 없음). `관리자` 는 `User.role = 'admin'` 이고 가드가 매 요청 DB 역할을 읽는다. 아니면 403 FORBIDDEN "관리자만 할 수 있어요" (D-285)
- 페이지: `nextCursor` 는 이 페이지 마지막 id. 다음 요청의 `cursor` 로 그대로 보낸다. null 이면 끝
- `unread` 와 `hasUnreadNotice` 는 `publishedAt > User.noticesSeenAt`(본 적 없으면 게시된 것 모두)
- 본문은 일반 텍스트. 빈 줄로 문단을 나누고 https 주소만 링크로 그린다(HTML 해석 없음)
- 숨긴 일정, 숨긴 팀의 일정은 멤버 경로에서 없는 것과 같다(`VISIBLE_EVENT_WHERE`, D-286). 숨긴 팀은 GROUP_HIDDEN, 초대 코드 INVITE_NOT_FOUND, 구독 피드 404, 알림 안 보냄
- 관리자 변경(공지 작성, 수정, 삭제, 역할 변경, 숨김, 해제, 삭제)은 모두 `AdminAction` 한 줄. 삭제는 대상 이름(제목)을 `reason` 에 남긴다
- 웹 프록시는 `GET /notices`, `/notices/:id` 를 쿠키 없이도 넘긴다(초대 미리보기와 같이)
- (#528, D-287) 공지 푸시: `push: true` 가 받아들여지면 같은 트랜잭션에서 `Notice.pushedAt = 지금` 과 `PushNotification { kind NOTICE, dedupeKey N:{id}, groupId null }` 을 만들고 조치 기록 `notice_push` 를 남긴 뒤 푸시 틱을 한 번 깨운다. 요청 안에서 기기로 보내지 않는다. 한 공지는 한 번만: 이미 보냈으면 409, 동시에 두 요청이 와도 하나만 된다(`pushedAt IS NULL` 조건부 갱신). 게시 취소 뒤 다시 게시해도 다시 보내지 않는다. 받는 사람과 문구는 푸시-알림.md 16장
- (#528) 개인 달력은 이름이 모두 "내 달력" 이라 관리자 화면은 `owner` 로 "{닉네임}의 개인 달력" 이라 부른다

## 3. 기획 기능 → API 추적

| 기획 기능 | 엔드포인트 |
|-----------|-----------|
| 카카오 로그인 | `/auth/kakao`, `/auth/kakao/callback`, `/me` |
| 이메일 로그인 (#245) | `/auth/email/request`, `/auth/email/link/inspect`, `/auth/email/link`, `/auth/email/code`, `/auth/email/signup` (이메일-로그인.md) |
| 앱 로그인 (카카오, 애플), 웹 애플 로그인 | `/auth/kakao/native`, `/auth/apple/native`, `/auth/apple`, `/auth/apple/callback`, `/auth/handoff` (앱.md) |
| 닉네임/프로필 사진 변경 | `PATCH /me`, `POST /me/avatar`, `DELETE /me/avatar` |
| 처음 여는 달력 (#300) | `GET /me` 의 `startCalendar`, `PATCH /me/start-calendar` |
| 멤버 생일 (#305) | `GET /me` 의 `birthday`, `PATCH /me/birthday`, `GET /groups/:id/birthdays`, `PATCH /groups/:id/me { showBirthday }` |
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
| 앱 푸시 기기 등록, 해제 (#188) | `PUT /me/push-devices`, `DELETE /me/push-devices` |
| 알림 설정 (종류별, 팀별) (#188) | `GET/PATCH /me/notification-settings`, `PATCH /groups/:id/me { notify }`, `GroupDetail.me.notify` |
| 일정 알림 시각 (#188) | `EventInput.reminder`, `Event.reminder` |
| 일정 참여자 (#248) | `EventInput.participants`, `Event.participants` |
| 일정 색 (#343) | `EventInput.color`, `Event.color`, `EventSharePreview.event.color` |
| 일정 카드 공유 (#274) | 2.10 전부 |
| ICS 파일로 일정 가져오기 (#279) | `POST /groups/:id/imports/preview`, `POST /groups/:id/imports` (2.9) |
| 팀 공유 할 일 목록 (#276) | 2.11 전부 |
| 외부 캘린더 구독 (#193) | 2.12 전부 |
| 약속 투표 (#189) | 2.13 전부, 알림 설정 `poll` |
| 공지사항, 새 공지 점 (#515) | `GET /notices`, `GET /notices/:id`, `POST /notices/seen`, `GET /me` 의 `hasUnreadNotice` |
| 관리자 화면 (#515) | 2.16 `/admin/*` 전부, `GET /me` 의 `role`, `isAdmin` |
| AI 비서 볼까 (#450) | 2.15 전부, `GET /me` 의 `assistant`, 저장은 `POST /groups/:id/events`, `POST /groups/:id/polls`, (#511) 고치기, 지우기는 `PATCH`, `DELETE /groups/:id/events/:eventId` |

## 4. 개발 전용

| 메서드 | 경로 | 인증 | 요청 | 응답 |
|--------|------|------|------|------|
| POST | `/auth/dev-login` | 없음 | `{ nickname(1~50) }` | `{ data: { token, user } }`. 카카오 없이 테스트 사용자를 만들고(같은 닉네임이면 재사용) JWT 를 발급. **`NODE_ENV !== 'production'` 에서만** 존재하고 운영에서는 404 NOT_FOUND (결정기록 D-29) |

- `KAKAO_CLIENT_ID` 가 비어 있어도 서버는 기동한다. 카카오가 필요한 엔드포인트(`/auth/kakao`, 실사용자 `DELETE /me` 의 unlink)만 503 `KAKAO_NOT_CONFIGURED` 를 돌려준다
