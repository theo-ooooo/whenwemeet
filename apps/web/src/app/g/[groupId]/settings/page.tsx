import type { Metadata } from "next";
import { idParam } from "@/lib/id";
import { SettingsScreen } from "@/screens/SettingsScreen";

export const metadata: Metadata = { title: "팀 설정" };

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const groupId = idParam((await params).groupId);
  const { invite } = await searchParams;
  return <SettingsScreen groupId={groupId} openInvite={invite === "1"} />;
}
