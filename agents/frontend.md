# 프론트 에이전트 — 언제볼까 (Next.js 16 + Tailwind 4)

## 역할
`docs/설계/화면흐름.md`, `api.md` 대로 화면을 만든다. 수정 영역은 `apps/web/` 만.

## 시작 전
1. `CLAUDE.md`, 설계 파일 읽기
2. `frontend-design:frontend-design` 스킬 로드 — 디자인 토큰(색 4~6, 서체, 레이아웃) 먼저 정하고 `docs/설계/디자인토큰.md` 에 기록 후 코딩
3. `apps/web/.env.example` → `.env.local`

## 구조
```
apps/web/src/
  app/
    layout.tsx              Pretendard, 한국어 lang, 메타
    page.tsx                로그인 여부 → /login 또는 /calendar
    login/page.tsx          카카오 로그인 버튼 (카카오 브랜드 가이드: #FEE500, 검정 글자)
    auth/callback/route.ts  API 가 넘긴 토큰을 httpOnly 쿠키로 저장 후 리다이렉트
    api/[...path]/route.ts  쿠키 토큰을 Bearer 로 붙여 API 에 프록시 (토큰을 JS 에 노출하지 않음)
    (app)/                  인증 필요 화면. proxy.ts(Next 16, middleware 후속) 에서 쿠키 없으면 /login
  components/               캘린더, 일정 시트, 팀 전환, 초대
  lib/api.ts                fetch 래퍼 (`/api/...` 호출, 봉투 해제, 오류 throw)
  lib/date.ts               date-fns + KST
```

## 데이터 접근 (반드시)
- 화면/컴포넌트는 `fetch`, `lib/api.ts` 를 **직접 부르지 않는다**. `src/hooks/use*.ts` 커스텀 훅만 쓴다
- 훅 하나 = 자원 하나. 조회: `useMe`, `useGroups`, `useGroup(id)`, `useEvents(groupId, range)`, `useEvent(groupId, id)`, `useAnniversaries(groupId)`, `useFreeSlots(groupId, params)`, `useNews(groupId)`. 변경: `useCreateEvent`, `useUpdateEvent`, `useDeleteEvent`, `useJoinGroup` 등
- 반환 형태 통일 — 조회 `{ data, error, isLoading, refetch }`, 변경 `{ mutate, isPending, error }`. 훅 안에서만 `lib/api.ts` 호출
- 서버 컴포넌트에서 초기 데이터가 필요하면 `lib/server-api.ts` (쿠키 포함 fetch) 로 가져와 훅의 `initialData` 로 넘긴다
- 캐시, 중복 요청 제거, 낙관적 갱신이 필요해지면 라이브러리를 넣지 말고 설계 에이전트에 요청

## 규칙
- 모바일 우선 (360px 기준), 데스크톱은 max-w 480 중앙 정렬
- 서버 컴포넌트 기본, 상호작용 있는 것만 `'use client'`
- 상태 관리 라이브러리 없이 시작. 필요해지면 설계 에이전트에 요청
- 접근성: 포커스 표시, 버튼엔 텍스트, 색만으로 멤버 구분하지 않음(이름 병기)
- 빈 상태/오류 문구는 "무엇이 비었고 다음에 뭘 하면 되는지" 한 문장

## 테스트
- 커밋 전 `pnpm --filter @whenwemeet/web build` 와 `lint` 통과
- 주요 흐름(로그인 → 팀 만들기 → 일정 추가) 은 ego-browser 로 직접 눌러보고 스크린샷 남김

## 금지
- `apps/api/` 수정, API 를 브라우저에서 직접 호출(프록시 경유만)
- 설계에 없는 화면 추가
