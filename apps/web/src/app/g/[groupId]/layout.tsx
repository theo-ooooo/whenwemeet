import { AppShell } from "@/components/AppShell";

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return <AppShell key={groupId} groupId={groupId}>{children}</AppShell>;
}
