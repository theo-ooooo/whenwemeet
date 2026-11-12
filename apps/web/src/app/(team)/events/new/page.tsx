import type { Metadata } from "next";
import { TeamScope } from "@/components/AppShell";
import { dateParam } from "@/lib/calendar-url";
import { lookupEvent } from "@/lib/event-lookup";
import { parsePublicCode } from "@/lib/routes";
import { EventFormScreen } from "@/screens/EventFormScreen";

export const metadata: Metadata = { title: "새 일정" };

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; copy?: string; occurrence?: string }>;
}) {
  const { start, end, copy, occurrence } = await searchParams;
  const valid = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  // copy=<일정 공개 코드>: 일정 상세의 "복제". 같은 값으로 새 일정 폼을 채운다 (#311). 코드 모양이 아니거나 못 찾으면 빈 폼.
  // occurrence: 반복 일정 회차를 복제할 때 그 회차 값으로 채운다 (#187)
  const copyCode = parsePublicCode(copy);
  const source = copyCode ? await lookupEvent(copyCode, dateParam(occurrence ?? null)) : null;
  const form = (
    <EventFormScreen
      copyFrom={source?.id}
      initialEvent={source}
      occurrence={source ? dateParam(occurrence ?? null) : null}
      initialStart={valid(start)}
      initialEnd={valid(end)}
    />
  );
  // 복제 원본의 팀으로 맞춘다 (다른 팀 일정 링크를 복제하는 경우)
  return source ? <TeamScope groupId={source.groupId}>{form}</TeamScope> : form;
}
