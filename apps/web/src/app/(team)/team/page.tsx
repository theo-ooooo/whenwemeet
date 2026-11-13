import type { Metadata } from "next";
import { SettingsScreen } from "@/screens/SettingsScreen";

export const metadata: Metadata = { title: "팀 설정" };

// (#311) 옛 /g/<id>/settings. `?invite=1` 이면 초대 섹션을 연 채로, (#278) `?feed=1` 이면 다른 캘린더 앱에서 보기 칸으로
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ invite?: string; feed?: string }> }) {
  const { invite, feed } = await searchParams;
  return <SettingsScreen openInvite={invite === "1"} showFeed={feed === "1"} />;
}
