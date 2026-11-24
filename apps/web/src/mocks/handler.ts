// API_MOCK=1 메모리 API. api.md 의 봉투와 상태 코드를 그대로 따른다. 응답은 전부 ok / err 를 거친다 (봉투 모양은 lib/envelope.ts).
// 라우트는 기능별로 routes/ 에 나눠 두고, 여기서는 원래 순서대로 차례로 불러 본다 (#491)
import { parseId } from "@/lib/id";
import { ME_ID } from "./fixtures";
import { mockEmailLogin } from "./email-login";
import { mockAssistantMessage, type MockCall } from "./assistant";
import { err, ok, store, type AuthedReq, type Ctx, type GroupReq, type MockResult, type Req } from "./routes/shared";
import { eventShareRoute, inviteRoute } from "./routes/public";
import { meRoutes } from "./routes/me";
import { groupDetailRoute, groupsRoute, inviteCodeRoute, joinRoute, membershipRoute } from "./routes/groups";
import { placeResolveRoute, placeSearchRoute } from "./routes/places";
import { eventCodeRoute, eventRestoreRoute, eventSearchRoute, groupEventRoutes } from "./routes/events";
import { groupTodoRoutes, todoCodeRoute } from "./routes/todos";
import { groupPollRoutes, pollCodeRoute } from "./routes/polls";
import { importsRoute } from "./routes/imports";
import { groupCalendarFeedRoute } from "./routes/calendar-feed";
import { anniversaryRoutes, birthdaysRoute } from "./routes/anniversaries";
import { freeSlotsRoute } from "./routes/free-slots";
import { newsRoutes } from "./routes/news";

export type { MockResult };

/** 로그인 뒤 라우트. 순서가 곧 우선순위다 (events/search 가 events/:code 보다 먼저) */
const AUTHED_ROUTES: ((req: AuthedReq) => MockResult | null)[] = [
  meRoutes,
  groupsRoute,
  joinRoute,
  // (#199) 일정 검색, 장소 검색, 다시 찾기 (events/:code 보다 먼저)
  eventSearchRoute,
  placeSearchRoute,
  placeResolveRoute,
  eventCodeRoute,
  todoCodeRoute,
  pollCodeRoute,
];

/** /groups/:groupId/... 라우트. 순서가 곧 우선순위다 */
const GROUP_ROUTES: ((req: GroupReq) => MockResult | null)[] = [
  importsRoute,
  groupDetailRoute,
  inviteCodeRoute,
  groupCalendarFeedRoute,
  membershipRoute,
  eventRestoreRoute,
  groupEventRoutes,
  birthdaysRoute,
  anniversaryRoutes,
  groupTodoRoutes,
  freeSlotsRoute,
  assistantRoute,
  groupPollRoutes,
  newsRoutes,
];

export function mockHandle(ctx: Ctx): MockResult {
  const s = store();
  const { method, query, body } = ctx;
  const path = ctx.path.replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);

  if (method === "GET" && path === "/health") return ok({ ok: true });

  const req: Req = { s, ctx, method, path, seg, query, body, handle: mockHandle };

  for (const route of [inviteRoute, eventShareRoute]) {
    const r = route(req);
    if (r) return r;
  }

  // (#245) 공개: 이메일 로그인 (웹 서버 전용 엔드포인트, 이메일-로그인.md 4장)
  const email = mockEmailLogin(s, method, path, body);
  if (email) return email;

  const userId = ctx.userId;
  if (!userId || !s.users.find((u) => u.id === userId)) {
    return err(401, "UNAUTHORIZED", "로그인이 필요해요");
  }

  const authed: AuthedReq = { ...req, userId };
  for (const route of AUTHED_ROUTES) {
    const r = route(authed);
    if (r) return r;
  }

  // /groups/:groupId/...
  if (seg[0] === "groups" && seg[1]) {
    const groupId = parseId(seg[1]);
    if (groupId === null) return err(400, "VALIDATION_FAILED", "groupId 은(는) 양의 정수여야 해요");
    const grp = s.groups.find((x) => x.id === groupId);
    if (!grp) return err(404, "NOT_FOUND", "팀을 찾을 수 없어요");
    const ms = s.memberships.find((m) => m.groupId === groupId && m.userId === userId);
    if (!ms) return err(403, "FORBIDDEN", "이 팀에 더 이상 속해 있지 않아요");
    const rest = seg.slice(2);
    const groupReq: GroupReq = { ...authed, groupId, grp, ms, rest };
    for (const route of GROUP_ROUTES) {
      const r = route(groupReq);
      if (r) return r;
    }
  }

  return err(404, "NOT_FOUND", "요청한 주소가 없어요");
}

// (#450) AI 비서. 데이터는 이 목 API 를 다시 불러 만든다 (mocks/assistant.ts)
function assistantRoute(req: GroupReq): MockResult | null {
  const { s, method, body, userId, groupId, rest } = req;
  if (rest[0] === "assistant" && rest[1] === "messages" && rest.length === 2 && method === "POST") {
    const call: MockCall = (m, p, q = {}) => {
      const r = mockHandle({ method: m, path: p, query: new URLSearchParams(q), body: null, userId });
      return r.status < 400 ? ((r.body as { data: unknown }).data as never) : null;
    };
    return mockAssistantMessage(s, groupId, userId, body, call);
  }
  return null;
}

/** 목 토큰에서 사용자 추출. 'mock.<userId>.sig' 형태(userId 는 숫자), 'mock.me.sig' 는 기본 사용자 */
export function mockUserFromToken(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  return parts[1] === "me" ? ME_ID : parseId(parts[1]);
}
