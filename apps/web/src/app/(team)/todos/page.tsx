import type { Metadata } from "next";
import { TodosScreen } from "@/screens/TodosScreen";

export const metadata: Metadata = { title: "할 일" };

/** (#276) 할 일 목록 `/todos[?new=1]` */
export default function TodosPage() {
  return <TodosScreen />;
}
