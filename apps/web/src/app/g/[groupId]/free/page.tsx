import type { Metadata } from "next";
import { idParam } from "@/lib/id";
import { FreeScreen } from "@/screens/FreeScreen";

export const metadata: Metadata = { title: "빈 시간 찾기" };

export default async function FreePage({ params }: { params: Promise<{ groupId: string }> }) {
  const groupId = idParam((await params).groupId);
  return <FreeScreen groupId={groupId} />;
}
