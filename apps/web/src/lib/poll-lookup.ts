// (#189) 서버 컴포넌트에서 투표 공개 코드로 투표 하나 (api.md 2.13 `GET /polls/:code`). 페이지가 팀을 알아내고 첫 데이터로 쓴다.
// 세션이 끝났으면 /auth/expired 로, 없거나 내 팀 투표가 아니면 null (페이지가 404 로)
import { redirect } from "next/navigation";
import { serverApi } from "./server-api";
import { expiredUrl } from "./session";
import type { Poll } from "./types";

export async function lookupPoll(code: string): Promise<Poll | null> {
  const from = `/polls/${code}`;
  const { data, status } = await serverApi<Poll>(`/polls/${code}`, { from });
  if (status === 401) redirect(expiredUrl(from));
  return data;
}
