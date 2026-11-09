import type { Metadata } from "next";
import { EventFormScreen } from "@/screens/EventFormScreen";

export const metadata: Metadata = { title: "새 일정" };

export default async function NewEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ start?: string; end?: string; copy?: string }>;
}) {
  const { groupId } = await params;
  const { start, end, copy } = await searchParams;
  const valid = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
    // copy=<eventId>: 일정 상세의 "복제". 같은 값으로 새 일정 폼을 채운다
  const copyFrom = copy && /^[A-Za-z0-9_-]+$/.test(copy) ? copy : undefined;
  return <EventFormScreen groupId={groupId} copyFrom={copyFrom} initialStart={valid(start)} initialEnd={valid(end)} />;
}
