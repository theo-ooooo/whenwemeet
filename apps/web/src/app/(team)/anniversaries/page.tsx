import type { Metadata } from "next";
import { AnniversariesScreen } from "@/screens/AnniversariesScreen";

export const metadata: Metadata = { title: "기념일" };

export default function AnniversariesPage() {
  return <AnniversariesScreen />;
}
