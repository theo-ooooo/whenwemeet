import type { Metadata } from "next";
import { idParam } from "@/lib/id";
import { NewsScreen } from "@/screens/NewsScreen";

export const metadata: Metadata = { title: "새 소식" };

export default async function NewsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const groupId = idParam((await params).groupId);
  return <NewsScreen groupId={groupId} />;
}
