// 분기: 쿠키 없으면 /login, 있으면 처음 여는 달력 설정(#300, lib/start-calendar.ts)을 따른다.
// 마지막에 본 달력(기본)이면 마지막 팀(wwm_group) 또는 PERSONAL 팀, 내 달력이면 PERSONAL 팀, 팀 고정이면 그 팀.
// 이 규칙은 맨 `/` 진입에만 쓴다. 딥링크(/g/..., /join/..., 알림 누름)는 여기를 거치지 않는다.
// wwm_group 에 남은 팀이 내 팀 목록에 없으면(나갔거나 삭제된 팀, 목 모드 잔여값) 무시하고 첫 팀으로 보낸다 (#18).
// 서버 컴포넌트는 쿠키를 지울 수 없으므로, 도착한 팀 화면(AppShell)이 유효한 팀 ID 로 덮어쓴다.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GROUP_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { parseId } from "@/lib/id";
import { serverApi } from "@/lib/server-api";
import { expiredUrl } from "@/lib/session";
import { pickStartGroupId } from "@/lib/start-calendar";
import type { GroupSummary, Me } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)?.value) redirect("/login");

  const raw = jar.get(GROUP_COOKIE)?.value;
  // 숫자 ID 가 아닌 값(예전 cuid 등)은 무시
  const remembered = parseId(raw);

  // 서버 장애(연결 실패, 500)면 serverApi 가 /maintenance 로 보낸다 (#54)
  const [groups, me] = await Promise.all([serverApi<GroupSummary[]>("/groups", { from: "/" }), serverApi<Me>("/me", { from: "/" })]);
  const { data, status } = groups;
  // 쿠키를 지우지 않고 /login 으로 보내면 /login ↔ / 가 반복된다. 쿠키를 지우는 route handler 경유 (#37)
  if (status === 401 || me.status === 401) redirect(expiredUrl("/"));

  // 그 밖의 이유로 목록을 못 받은 경우는 검증할 수 없으니 기억한 팀으로 보내고, 그 화면의 오류 상태에 맡긴다
  if (!data) {
    if (remembered !== null) redirect(`/g/${remembered}/calendar`);
    redirect("/groups/new");
  }

  // 설정을 못 읽으면(GET /me 실패) 마지막에 본 달력 규칙
  const target = pickStartGroupId(data, me.data?.startCalendar ?? null, remembered);
  if (target !== null) redirect(`/g/${target}/calendar`);

  // 팀이 하나도 없는 비정상 상태: 새 팀 만들기로
  redirect("/groups/new");
}
