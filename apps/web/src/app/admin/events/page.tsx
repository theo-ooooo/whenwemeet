import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminEventsScreen } from "@/screens/admin/AdminEventsScreen";

export const metadata: Metadata = { title: "일정" };

export default function AdminEventsPage() {
  return (
    <Suspense>
      <AdminEventsScreen />
    </Suspense>
  );
}
