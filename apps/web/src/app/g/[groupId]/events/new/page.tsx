import type { Metadata } from "next";
import { EventFormScreen } from "@/screens/EventFormScreen";

export const metadata: Metadata = { title: "새 일정" };

export default async function NewEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const { groupId } = await params;
  const { start, end } = await searchParams;
  const valid = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
  return <EventFormScreen groupId={groupId} initialStart={valid(start)} initialEnd={valid(end)} />;
}
