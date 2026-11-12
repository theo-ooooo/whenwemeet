// (#276) 서버 컴포넌트에서 목록 공개 코드로 목록 하나 (api.md 2.11 `GET /todo-lists/:code`). 페이지가 팀을 알아내고 첫 데이터로 쓴다.
// 세션이 끝났으면 /auth/expired 로, 없거나 내 팀 목록이 아니면 null (페이지가 404 로)
import { redirect } from "next/navigation";
import { serverApi } from "./server-api";
import { expiredUrl } from "./session";
import type { TodoListDetail } from "./types";

export async function lookupTodoList(code: string): Promise<TodoListDetail | null> {
  const from = `/todos/${code}`;
  const { data, status } = await serverApi<TodoListDetail>(`/todo-lists/${code}`, { from });
  if (status === 401) redirect(expiredUrl(from));
  return data;
}
