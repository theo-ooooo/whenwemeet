import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseId } from "@/lib/id";
import { AdminUserScreen } from "@/screens/admin/AdminUserScreen";

export const metadata: Metadata = { title: "사용자 상세" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  return <AdminUserScreen id={id} />;
}
