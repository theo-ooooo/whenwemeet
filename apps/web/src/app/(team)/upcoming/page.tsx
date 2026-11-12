import type { Metadata } from "next";
import { UpcomingScreen } from "@/screens/UpcomingScreen";

export const metadata: Metadata = { title: "다가오는 일정" };

export default function UpcomingPage() {
  return <UpcomingScreen />;
}
