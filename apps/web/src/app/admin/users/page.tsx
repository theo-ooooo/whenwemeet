import type { Metadata } from "next";
import { AdminUsersScreen } from "@/screens/admin/AdminUsersScreen";

export const metadata: Metadata = { title: "사용자" };

export default async function AdminUsersPage() {
  return <AdminUsersScreen />;
}
