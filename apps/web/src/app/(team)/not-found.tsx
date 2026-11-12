// 팀 화면 안의 404 (#64): /events/abc 처럼 일정 코드가 틀리거나 없는 일정인 경우 (AppShell 안의 타일)
import { GroupNotFound } from "@/components/NotFound";
import { CALENDAR_PATH } from "@/lib/routes";

export default function TeamNotFoundPage() {
  return <GroupNotFound calendarHref={CALENDAR_PATH} />;
}
