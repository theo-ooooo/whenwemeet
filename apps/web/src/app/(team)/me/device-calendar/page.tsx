import type { Metadata } from "next";
import { DeviceCalendarScreen } from "@/screens/DeviceCalendarScreen";

export const metadata: Metadata = { title: "휴대폰 캘린더" };

// (#549) 내 정보 > 휴대폰 캘린더 (앱.md 4.9, D-294). 셸 능력 판정은 브라우저에서 (UA + ReactNativeWebView)
export default function DeviceCalendarPage() {
  return <DeviceCalendarScreen />;
}
