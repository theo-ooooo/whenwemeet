import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseId } from "@/lib/id";
import { AdminTeamScreen } from "@/screens/admin/AdminTeamScreen";

export const metadata: Metadata = { title: "팀 상세" };

export default async function AdminTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  return <AdminTeamScreen id={id} />;
}
