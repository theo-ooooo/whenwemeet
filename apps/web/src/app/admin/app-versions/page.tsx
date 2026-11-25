import type { Metadata } from "next";
import { AdminAppVersionsScreen } from "@/screens/admin/AdminAppVersionsScreen";

// (#539) 기종별 앱 최신, 최소 버전 (D-292)
export const metadata: Metadata = { title: "앱 버전" };

export default function AdminAppVersionsPage() {
  return <AdminAppVersionsScreen />;
}
