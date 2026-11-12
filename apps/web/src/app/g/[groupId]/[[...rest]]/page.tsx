// (#311, D-199) 옛 주소 `/g/<팀 번호>/...` 호환. 앱 1.1.x 의 알림, 이미 보낸 알림, 공유된 링크가 계속 열리게
// 멤버십을 확인한 뒤 새 주소로 308 (`?team=<팀 공개 코드>` 를 붙여 AppShell 이 쿠키를 바꾼다). 일정 번호는 공개 코드로 바꾼다.
// 멤버가 아니거나 없는 팀은 지금처럼 "이 팀을 열 수 없어요", 모르는 하위 경로는 404
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { GroupGone } from "@/components/GroupGone";
import { parseId } from "@/lib/id";
import { legacyRoute, legacyTarget } from "@/lib/legacy-routes";
import { serverApi } from "@/lib/server-api";
import { expiredUrl } from "@/lib/session";
import type { Event, GroupDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LegacyGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; rest?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { groupId: raw, rest = [] } = await params;
  const groupId = parseId(raw);
  if (groupId === null) notFound();
  const sp = await searchParams;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") search.set(k, v);
  const route = legacyRoute(rest, search);
  if (route === null) notFound();

  const from = `/g/${groupId}${rest.length ? `/${rest.join("/")}` : ""}`;
  const group = await serverApi<GroupDetail>(`/groups/${groupId}`, { from });
  if (group.status === 401) redirect(expiredUrl(from));
  // 403 멤버 아님, 404 없는 팀: 지금과 같은 안내 (#18)
  if (!group.data) return <GroupGone />;

  let eventCode: string | null = null;
  if (route.eventRef) {
    const ev = await serverApi<Event>(`/groups/${groupId}/events/${route.eventRef.eventId}`, { from });
    eventCode = ev.data?.publicCode ?? null;
  }
  permanentRedirect(legacyTarget(route, group.data.publicCode, eventCode));
}
