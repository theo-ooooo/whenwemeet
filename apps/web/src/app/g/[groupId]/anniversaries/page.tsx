import type { Metadata } from "next";
import { idParam } from "@/lib/id";
import { AnniversariesScreen } from "@/screens/AnniversariesScreen";

export const metadata: Metadata = { title: "기념일" };

export default async function AnniversariesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const groupId = idParam((await params).groupId);
  return <AnniversariesScreen groupId={groupId} />;
}
