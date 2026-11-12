import type { Metadata } from "next";
import { NewsScreen } from "@/screens/NewsScreen";

export const metadata: Metadata = { title: "새 소식" };

export default function NewsPage() {
  return <NewsScreen />;
}
