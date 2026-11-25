import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseId } from "@/lib/id";
import { AdminReportScreen } from "@/screens/admin/AdminReportScreen";

// (#536) 신고 대상 상세 /admin/reports/{group|event|user}/{id}
export const metadata: Metadata = { title: "신고 상세" };

export default async function AdminReportPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id: raw } = await params;
  const id = parseId(raw);
  if (id === null || (type !== "group" && type !== "event" && type !== "user")) notFound();
  return <AdminReportScreen targetType={type} targetId={id} />;
}
