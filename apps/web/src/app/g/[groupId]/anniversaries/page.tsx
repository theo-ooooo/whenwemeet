import type { Metadata } from "next";
import { AnniversariesScreen } from "@/screens/AnniversariesScreen";

export const metadata: Metadata = { title: "기념일" };

export default async function AnniversariesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return <AnniversariesScreen groupId={groupId} />;
}
