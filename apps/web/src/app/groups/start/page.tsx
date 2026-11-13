// (#278) 팀 만들기 직후 첫 단계 `/groups/start?preset=<쓰임>[&from=calendar]`. 팀은 주소에 없고 쿠키 wwm_group (만들기 화면이 방금 쓴 팀).
// 쿠키가 없으면 달력으로, 모르는 쓰임이면 초대 화면으로 (D-250)
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GROUP_COOKIE } from "@/lib/auth";
import { parseId } from "@/lib/id";
import { calendarHref, teamHref } from "@/lib/routes";
import { parsePreset } from "@/lib/team-preset";
import { StartScreen } from "@/screens/StartScreen";

export const metadata: Metadata = { title: "시작하기" };

export default async function StartPage({ searchParams }: { searchParams: Promise<{ preset?: string; from?: string }> }) {
  const { preset: raw, from } = await searchParams;
  const groupId = parseId((await cookies()).get(GROUP_COOKIE)?.value);
  if (groupId === null) redirect(calendarHref());
  const preset = parsePreset(raw);
  const fromCalendar = from === "calendar";
  if (!preset) redirect(fromCalendar ? calendarHref() : teamHref({ invite: true }));
  return <StartScreen key={`${groupId}:${preset}`} groupId={groupId} preset={preset} fromCalendar={fromCalendar} />;
}
