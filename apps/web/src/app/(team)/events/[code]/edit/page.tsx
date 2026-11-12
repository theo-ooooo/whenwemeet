import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeamScope } from "@/components/AppShell";
import { dateParam } from "@/lib/calendar-url";
import { lookupEvent } from "@/lib/event-lookup";
import { parsePublicCode } from "@/lib/routes";
import { EventFormScreen } from "@/screens/EventFormScreen";

export const metadata: Metadata = { title: "일정" };

/** (#311) 일정 수정 화면 `/events/<일정 공개 코드>/edit`. 옛 /g/<id>/events/<번호> */
export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ occurrence?: string; scope?: string }>;
}) {
  const code = parsePublicCode((await params).code);
  if (code === null) notFound();
  const { occurrence, scope } = await searchParams;
  // occurrence=YYYY-MM-DD: 반복 일정의 회차 (#187). 실제 날짜가 아니면 무시하고 첫 회차
  // scope=this|following: 범위를 미리 정해 왔을 때. 그 밖의 값은 무시하고 저장할 때 묻는다
  const occ = dateParam(occurrence ?? null);
  const event = await lookupEvent(code, occ);
  if (!event) notFound();
  return (
    <TeamScope groupId={event.groupId}>
      <EventFormScreen eventId={event.id} initialEvent={event} occurrence={occ} presetScope={scope === "this" || scope === "following" ? scope : null} />
    </TeamScope>
  );
}
