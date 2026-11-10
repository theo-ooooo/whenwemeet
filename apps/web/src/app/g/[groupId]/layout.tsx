import { AppShell } from "@/components/AppShell";
import { idParam } from "@/lib/id";

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const groupId = idParam((await params).groupId);
  return <AppShell key={groupId} groupId={groupId}>{children}</AppShell>;
}
