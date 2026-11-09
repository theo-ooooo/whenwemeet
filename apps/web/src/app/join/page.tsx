import type { Metadata } from "next";
import { JoinCodeScreen } from "@/screens/JoinCodeScreen";

export const metadata: Metadata = { title: "초대 코드로 합류" };

export default function JoinCodePage() {
  return <JoinCodeScreen />;
}
