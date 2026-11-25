import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseId } from "@/lib/id";
import { AdminNoticeForm } from "@/screens/admin/AdminNoticeForm";

export const metadata: Metadata = { title: "공지 수정" };

export default async function AdminNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  return <AdminNoticeForm id={id} />;
}
