import type { Metadata } from "next";
import { idParam } from "@/lib/id";
import { EventFormScreen } from "@/screens/EventFormScreen";

export const metadata: Metadata = { title: "일정" };

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ groupId: string; eventId: string }>;
}) {
  const { groupId, eventId } = await params;
  return <EventFormScreen groupId={idParam(groupId)} eventId={idParam(eventId)} />;
}
