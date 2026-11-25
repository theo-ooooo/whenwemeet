import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminReportsScreen } from "@/screens/admin/AdminReportsScreen";

// (#536) 관리자 신고 탭 (D-289)
export const metadata: Metadata = { title: "신고" };

export default function AdminReportsPage() {
  return (
    <Suspense>
      <AdminReportsScreen />
    </Suspense>
  );
}
