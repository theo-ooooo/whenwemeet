import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeamScope } from "@/components/AppShell";
import { parsePublicCode } from "@/lib/routes";
import { lookupTodoList } from "@/lib/todo-lookup";
import { TodoListScreen } from "@/screens/TodoListScreen";

export const metadata: Metadata = { title: "할 일" };

/**
 * (#276, D-209) 할 일 목록 상세 `/todos/<목록 공개 코드>`. 주소에 팀이 없으므로(D-196) 서버가 코드로 목록을 찾아 팀을 알아내고
 * TeamScope 로 그 팀에 맞춘다(일정 상세 D-198 과 같은 방식). 코드가 틀리거나 없거나 내 팀 목록이 아니면 404 (API 가 구분하지 않는다)
 */
export default async function TodoListPage({ params }: { params: Promise<{ code: string }> }) {
  const code = parsePublicCode((await params).code);
  if (code === null) notFound();
  const detail = await lookupTodoList(code);
  if (!detail) notFound();
  return (
    <TeamScope groupId={detail.list.groupId}>
      <TodoListScreen code={code} initial={detail} />
    </TeamScope>
  );
}
