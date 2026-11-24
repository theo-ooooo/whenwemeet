// 목 API 공용: 메모리 상태, 봉투(ok / err), 요청 묶음. 라우트 파일은 전부 여기를 거친다 (#491)
import { errorBody, okBody } from "@/lib/envelope";
import { buildStore, type GroupRow, type MembershipRow, type Store } from "../fixtures";

export type MockResult = { status: number; body: unknown };

export type Ctx = {
  method: string;
  path: string; // '/groups/2/events'
  query: URLSearchParams;
  body: Record<string, unknown> | null;
  userId: number | null;
};

// dev HMR 로 모듈이 다시 평가돼도 상태가 남도록 globalThis 에 둔다
const g = globalThis as unknown as { __wwmMockStore?: Store };
export function store(): Store {
  if (!g.__wwmMockStore) g.__wwmMockStore = buildStore();
  return g.__wwmMockStore;
}

/** DELETE /me: 목에서는 탈퇴 처리 대신 상태를 초기화한다 */
export function resetStore(): void {
  g.__wwmMockStore = buildStore();
}

export const ok = (data: unknown, status = 200): MockResult => ({ status, body: okBody(data, status) });
/** (#300) 처음 여는 달력 기본값 */
export const START_LAST = { mode: "LAST", groupId: null } as const;

export const err = (status: number, code: string, message: string): MockResult => ({
  status,
  body: errorBody(status, code, message),
});

export const nextId = () => (store().seq += 1);
export const nowIso = () => new Date().toISOString();

export const DAY_MS = 86_400_000;

export const isResult = (v: unknown): v is MockResult => typeof v === "object" && v !== null && "status" in v && "body" in v;

/** 그 팀 지금 멤버 userId (가입순) */
export function memberIdsOf(s: Store, groupId: number): number[] {
  return s.memberships
    .filter((m) => m.groupId === groupId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map((m) => m.userId);
}

/** 디스패처가 라우트에 넘기는 요청. path 는 끝 / 를 뗀 값, seg 는 그 조각, handle 은 목 API 를 다시 부를 때 */
export type Req = {
  s: Store;
  ctx: Ctx;
  method: string;
  path: string;
  seg: string[];
  query: URLSearchParams;
  body: Record<string, unknown> | null;
  handle: (ctx: Ctx) => MockResult;
};

/** 로그인 확인 뒤 */
export type AuthedReq = Req & { userId: number };

/** /groups/:groupId/... (멤버 확인 뒤). rest 는 groupId 뒤 조각 */
export type GroupReq = AuthedReq & { groupId: number; grp: GroupRow; ms: MembershipRow; rest: string[] };
