import type { Metadata } from "next";
import { NewsScreen } from "@/screens/NewsScreen";

export const metadata: Metadata = { title: "새 소식" };

export default async function NewsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return <NewsScreen groupId={groupId} />;
}
