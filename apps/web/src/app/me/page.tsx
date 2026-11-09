import type { Metadata } from "next";
import { MeScreen } from "@/screens/MeScreen";

export const metadata: Metadata = { title: "내 정보" };

export default function MePage() {
  return <MeScreen />;
}
