import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseId } from "@/lib/id";
import { AdminEventScreen } from "@/screens/admin/AdminEventScreen";

export const metadata: Metadata = { title: "일정 상세" };

export default async function AdminEventPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  return <AdminEventScreen id={id} />;
}
