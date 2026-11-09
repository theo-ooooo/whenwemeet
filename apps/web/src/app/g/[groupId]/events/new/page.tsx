import type { Metadata } from "next";
import { idParam, parseId } from "@/lib/id";
import { EventFormScreen } from "@/screens/EventFormScreen";

export const metadata: Metadata = { title: "새 일정" };

export default async function NewEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ start?: string; end?: string; copy?: string }>;
}) {
  const groupId = idParam((await params).groupId);
  const { start, end, copy } = await searchParams;
  const valid = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  // copy=<eventId>: 일정 상세의 "복제". 같은 값으로 새 일정 폼을 채운다. 양의 정수가 아니면 무시하고 빈 폼
  const copyFrom = parseId(copy) ?? undefined;
  return <EventFormScreen groupId={groupId} copyFrom={copyFrom} initialStart={valid(start)} initialEnd={valid(end)} />;
}
