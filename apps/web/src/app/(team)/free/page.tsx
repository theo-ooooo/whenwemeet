import type { Metadata } from "next";
import { FreeScreen } from "@/screens/FreeScreen";

export const metadata: Metadata = { title: "빈 시간 찾기" };

export default function FreePage() {
  return <FreeScreen />;
}
