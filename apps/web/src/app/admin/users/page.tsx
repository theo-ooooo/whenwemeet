import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminUsersScreen } from "@/screens/admin/AdminUsersScreen";

export const metadata: Metadata = { title: "사용자" };

export default async function AdminUsersPage() {
  return (
    <Suspense>
      <AdminUsersScreen />
    </Suspense>
  );
}
