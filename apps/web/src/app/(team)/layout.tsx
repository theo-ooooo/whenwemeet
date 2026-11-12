// (#311, D-196) 팀 안 화면 공통 레이아웃. 주소에 팀이 없으므로 처음 팀은 쿠키 wwm_group 에서 읽어 AppShell 에 넘긴다.
// 쿠키가 없으면(첫 로그인 뒤 /calendar 로 바로 온 경우, 로그아웃 뒤) 팀 목록을 받아 LAST 규칙(개인 팀, 없으면 첫 팀)으로 고른다 (lib/start-calendar.ts).
// 그 뒤의 팀 바꾸기, `?team=<코드>`, 쿠키의 팀이 내 팀이 아닐 때의 처리는 AppShell 이 한다 (서버 컴포넌트는 쿠키를 쓸 수 없다)
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { GROUP_COOKIE } from "@/lib/auth";
import { parseId } from "@/lib/id";
import { CALENDAR_PATH } from "@/lib/routes";
import { serverApi } from "@/lib/server-api";
import { expiredUrl } from "@/lib/session";
import { pickStartGroupId } from "@/lib/start-calendar";
import type { GroupSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const remembered = parseId(jar.get(GROUP_COOKIE)?.value);
  if (remembered !== null) return <AppShell initialGroupId={remembered}>{children}</AppShell>;

  // 서버 장애(연결 실패, 500)면 serverApi 가 /maintenance 로 보낸다 (#54)
  const { data, status } = await serverApi<GroupSummary[]>("/groups", { from: CALENDAR_PATH });
  if (status === 401) redirect(expiredUrl(CALENDAR_PATH));
  // 목록을 못 받았으면(429 등) AppShell 이 브라우저에서 다시 받아 고른다
  const picked = data ? pickStartGroupId(data, null, null) : null;
  if (data && picked === null) redirect("/groups/new");
  return (
    <AppShell initialGroupId={picked} initialGroups={data}>
      {children}
    </AppShell>
  );
}
