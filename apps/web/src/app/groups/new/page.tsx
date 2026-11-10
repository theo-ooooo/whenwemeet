import type { Metadata } from "next";
import { NewGroupScreen } from "@/screens/NewGroupScreen";

export const metadata: Metadata = { title: "새 팀 만들기" };

export default function NewGroupPage() {
  return <NewGroupScreen />;
}
