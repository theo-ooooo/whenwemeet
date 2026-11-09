// 분기: 쿠키 없으면 /login, 있으면 마지막 팀(wwm_group) 또는 PERSONAL 팀의 달력으로
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GROUP_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { serverApi } from "@/lib/upstream";
import type { GroupSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)?.value) redirect("/login");

  const remembered = jar.get(GROUP_COOKIE)?.value;
  if (remembered && /^[A-Za-z0-9_-]+$/.test(remembered)) {
    redirect(`/g/${remembered}/calendar`);
  }

  const { data, status } = await serverApi<GroupSummary[]>("/groups");
  if (status === 401) redirect("/login");
  const personal = data?.find((g) => g.type === "PERSONAL") ?? data?.[0];
  if (personal) redirect(`/g/${personal.id}/calendar`);

  // 팀이 하나도 없는 비정상 상태: 새 팀 만들기로
  redirect("/groups/new");
}
