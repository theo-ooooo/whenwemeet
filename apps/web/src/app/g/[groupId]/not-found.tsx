"use client";
// 팀 화면 안의 404 (#64): /g/<팀>/events/abc 처럼 하위 페이지의 ID 가 틀린 경우. 팀 ID 자체가 틀리면(/g/abc) layout 이 던져 app/not-found.tsx 가 그린다
import { useParams } from "next/navigation";
import { GroupNotFound } from "@/components/NotFound";
import { parseId } from "@/lib/id";

export default function GroupNotFoundPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const id = parseId(groupId);
  return <GroupNotFound calendarHref={id === null ? "/" : `/g/${id}/calendar`} />;
}
