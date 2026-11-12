import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeamScope } from "@/components/AppShell";
import { dateParam } from "@/lib/calendar-url";
import { dateKeyOf } from "@/lib/date";
import { lookupEvent } from "@/lib/event-lookup";
import { parsePublicCode } from "@/lib/routes";
import { CalendarScreen } from "@/screens/CalendarScreen";

export const metadata: Metadata = { title: "일정" };

/**
 * (#311, D-198) 일정 상세 `/events/<일정 공개 코드>[?occurrence=]`. 달력 화면 위에 그 일정의 날짜 상세 → 일정 상세를 연 채로 그린다.
 * 달력에서 일정을 누르면 pushState 로 이 주소가 되고(페이지 교체 없음), 새로 고침이나 알림, 공유로 바로 들어오면 여기서
 * 서버가 일정을 찾아 팀과 날짜를 알아낸다. 코드가 틀리거나 없거나 내 팀 일정이 아니면 404 (API 가 구분하지 않는다)
 */
export default async function EventPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ occurrence?: string }> }) {
  const code = parsePublicCode((await params).code);
  if (code === null) notFound();
  const occurrence = dateParam((await searchParams).occurrence ?? null);
  const event = await lookupEvent(code, occurrence);
  if (!event) notFound();
  return (
    <TeamScope groupId={event.groupId}>
      <CalendarScreen initialEvent={{ code, date: dateKeyOf(event.startsAt), occurrence: event.occurrence }} />
    </TeamScope>
  );
}
