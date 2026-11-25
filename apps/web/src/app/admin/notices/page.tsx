import type { Metadata } from "next";
import { AdminNoticesScreen } from "@/screens/admin/AdminNoticesScreen";

export const metadata: Metadata = { title: "공지사항" };

export default function AdminNoticesPage() {
  return <AdminNoticesScreen />;
}
