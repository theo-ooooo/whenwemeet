import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminTeamsScreen } from "@/screens/admin/AdminTeamsScreen";

export const metadata: Metadata = { title: "팀" };

export default function AdminTeamsPage() {
  return (
    <Suspense>
      <AdminTeamsScreen />
    </Suspense>
  );
}
