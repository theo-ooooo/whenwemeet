import type { Metadata } from "next";
import { dateParam } from "@/lib/calendar-url";
import { idParam } from "@/lib/id";
import { EventFormScreen } from "@/screens/EventFormScreen";

export const metadata: Metadata = { title: "일정" };

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; eventId: string }>;
  searchParams: Promise<{ occurrence?: string; scope?: string }>;
}) {
  const { groupId, eventId } = await params;
  const { occurrence, scope } = await searchParams;
  // occurrence=YYYY-MM-DD: 반복 일정의 회차 (#187). 실제 날짜가 아니면 무시하고 첫 회차
  // scope=this|following: 범위를 미리 정해 왔을 때. 그 밖의 값은 무시하고 저장할 때 묻는다
  return (
    <EventFormScreen
      groupId={idParam(groupId)}
      eventId={idParam(eventId)}
      occurrence={dateParam(occurrence ?? null)}
      presetScope={scope === "this" || scope === "following" ? scope : null}
    />
  );
}
