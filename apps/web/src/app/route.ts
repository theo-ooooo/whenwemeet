// 맨 `/` 진입 (#311 부터 route handler). 쿠키 없으면 웹은 소개 페이지 /welcome, 앱 셸은 /login (#407), 있으면 처음 여는 달력 설정(#300, lib/start-calendar.ts)대로 팀을 골라
// wwm_group 쿠키에 써 두고 /calendar 로 307. 마지막에 본 달력(기본)이면 마지막 팀(wwm_group) 또는 PERSONAL 팀, 내 달력이면 PERSONAL 팀, 팀 고정이면 그 팀.
// 이 규칙은 맨 `/` 진입에만 쓴다. 딥링크(/calendar?team=, /events/..., /join/..., 알림 누름)는 여기를 거치지 않는다.
// wwm_group 에 남은 팀이 내 팀 목록에 없으면(나갔거나 삭제된 팀, 목 모드 잔여값) 무시하고 첫 팀으로 보낸다 (#18).
// 서버 컴포넌트는 쿠키를 쓸 수 없어 route handler 로 둔다 (주소에 팀이 없으니 쿠키가 곧 팀이다)
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { GROUP_COOKIE, GROUP_MAX_AGE, SESSION_COOKIE } from "@/lib/auth";
import { parseId } from "@/lib/id";
import { CALENDAR_PATH } from "@/lib/routes";
import { serverApi } from "@/lib/server-api";
import { expiredUrl } from "@/lib/session";
import { pickStartGroupId } from "@/lib/start-calendar";
import { signedOutHome } from "@/lib/welcome";
import type { GroupSummary, Me } from "@/lib/types";

export const dynamic = "force-dynamic";

const to = (req: NextRequest, path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin), { status: 307, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)?.value) return to(req, signedOutHome(req.headers.get("user-agent")));

  // 숫자 ID 가 아닌 값(예전 cuid 등)은 무시
  const remembered = parseId(jar.get(GROUP_COOKIE)?.value);

  // 서버 장애(연결 실패, 500)면 serverApi 가 /maintenance 로 보낸다 (#54)
  const [groups, me] = await Promise.all([serverApi<GroupSummary[]>("/groups", { from: "/" }), serverApi<Me>("/me", { from: "/" })]);
  // 쿠키를 지우지 않고 /login 으로 보내면 /login ↔ / 가 반복된다. 쿠키를 지우는 route handler 경유 (#37)
  if (groups.status === 401 || me.status === 401) return to(req, expiredUrl("/"));

  // 그 밖의 이유로 목록을 못 받은 경우는 검증할 수 없으니 기억한 팀으로 보내고(쿠키 그대로), 그 화면의 처리에 맡긴다
  if (!groups.data) return to(req, remembered !== null ? CALENDAR_PATH : "/groups/new");

  // 설정을 못 읽으면(GET /me 실패) 마지막에 본 달력 규칙
  const target = pickStartGroupId(groups.data, me.data?.startCalendar ?? null, remembered);
  // 팀이 하나도 없는 비정상 상태: 새 팀 만들기로
  if (target === null) return to(req, "/groups/new");

  const res = to(req, CALENDAR_PATH);
  if (target !== remembered) res.cookies.set(GROUP_COOKIE, String(target), { path: "/", maxAge: GROUP_MAX_AGE, sameSite: "lax" });
  return res;
}
