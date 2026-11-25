import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminDashboardScreen } from "@/screens/admin/AdminDashboardScreen";

// (#537) /admin 은 대시보드 (첫 탭, D-290). 예전에는 공지사항으로 보냈다 (#515)
export const metadata: Metadata = { title: "대시보드" };

export default function AdminHome() {
  return (
    <Suspense>
      <AdminDashboardScreen />
    </Suspense>
  );
}
