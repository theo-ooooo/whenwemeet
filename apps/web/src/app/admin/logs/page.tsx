import type { Metadata } from "next";
import { AdminLogsScreen } from "@/screens/admin/AdminLogsScreen";

export const metadata: Metadata = { title: "기록" };

export default function AdminLogsPage() {
  return <AdminLogsScreen />;
}
