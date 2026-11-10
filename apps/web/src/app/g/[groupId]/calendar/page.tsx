import type { Metadata } from "next";
import { idParam } from "@/lib/id";
import { CalendarScreen } from "@/screens/CalendarScreen";

export const metadata: Metadata = { title: "달력" };

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const groupId = idParam((await params).groupId);
  const { date } = await searchParams;
  const initialDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  return <CalendarScreen groupId={groupId} initialDate={initialDate} />;
}
