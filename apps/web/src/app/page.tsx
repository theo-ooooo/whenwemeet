// 분기: 쿠키 없으면 /login, 있으면 마지막 팀(wwm_group) 또는 PERSONAL 팀의 달력으로
// wwm_group 에 남은 팀이 내 팀 목록에 없으면(나갔거나 삭제된 팀, 목 모드 잔여값) 무시하고 첫 팀으로 보낸다 (#18).
// 서버 컴포넌트는 쿠키를 지울 수 없으므로, 도착한 팀 화면(AppShell)이 유효한 팀 ID 로 덮어쓴다.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GROUP_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { serverApi } from "@/lib/server-api";
import { expiredUrl } from "@/lib/session";
import type { GroupSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)?.value) redirect("/login");

  const raw = jar.get(GROUP_COOKIE)?.value;
  const remembered = raw && /^[A-Za-z0-9_-]+$/.test(raw) ? raw : null;

  const { data, status } = await serverApi<GroupSummary[]>("/groups");
  // 쿠키를 지우지 않고 /login 으로 보내면 /login ↔ / 가 반복된다. 쿠키를 지우는 route handler 경유 (#37)
  if (status === 401) redirect(expiredUrl("/"));

  // 목록을 못 받은 경우(API 장애 등)는 검증할 수 없으니 기억한 팀으로 보내고, 그 화면의 오류 상태에 맡긴다
  if (!data) {
    if (remembered) redirect(`/g/${remembered}/calendar`);
    redirect("/groups/new");
  }

  if (remembered && data.some((g) => g.id === remembered)) {
    redirect(`/g/${remembered}/calendar`);
  }

  const first = data.find((g) => g.type === "PERSONAL") ?? data[0];
  if (first) redirect(`/g/${first.id}/calendar`);

  // 팀이 하나도 없는 비정상 상태: 새 팀 만들기로
  redirect("/groups/new");
}
