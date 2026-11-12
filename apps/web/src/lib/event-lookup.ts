// (#311) 서버 컴포넌트에서 일정 공개 코드로 일정 하나 (api.md 2.3 `GET /events/:code`). 페이지가 팀과 날짜를 알아내는 데 쓴다.
// 세션이 끝났으면 /auth/expired 로, 없거나 내 팀이 아니거나 회차가 없으면 null (페이지가 404 로)
import { redirect } from "next/navigation";
import { serverApi } from "./server-api";
import { expiredUrl } from "./session";
import type { EventDetailData } from "./types";
import type { DateKey } from "./date";

export async function lookupEvent(code: string, occurrence: DateKey | null): Promise<EventDetailData | null> {
  const path = `/events/${code}${occurrence ? `?occurrence=${occurrence}` : ""}`;
  const { data, status } = await serverApi<EventDetailData>(path, { from: `/events/${code}` });
  if (status === 401) redirect(expiredUrl(`/events/${code}`));
  return data;
}
