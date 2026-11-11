import type { Metadata } from "next";
import { NotificationSettingsScreen } from "@/screens/NotificationSettingsScreen";

export const metadata: Metadata = { title: "알림" };

// (#188) 내 정보 > 알림 (푸시-알림.md 8장)
export default function NotificationsPage() {
  return <NotificationSettingsScreen />;
}
