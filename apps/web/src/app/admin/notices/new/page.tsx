import type { Metadata } from "next";
import { AdminNoticeForm } from "@/screens/admin/AdminNoticeForm";

export const metadata: Metadata = { title: "새 공지" };

export default function AdminNewNoticePage() {
  return <AdminNoticeForm id={null} />;
}
