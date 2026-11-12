"use client";
// 같이 쓰기 입구 (#172): 혼자인 팀은 '초대하기', 개인 달력만 있는 사용자는 '팀 만들기 / 초대 코드 입력'.
// 달력 위 정보 카드의 첫 줄(아이콘 16 + 13/500 + --acc-ink 링크). 닫으면 이 브라우저에서 다시 안 보인다
import Link from "next/link";
import { teamHref } from "@/lib/routes";
import { IconChevronRight, IconClose, IconTeam } from "./icons";
import { dismissHint, useHintDismissed } from "@/lib/hint";
import type { GroupDetail, GroupSummary } from "@/lib/types";

export type TogetherHintKind = { kind: "invite"; groupId: number } | { kind: "start" };

/** 보여 줄 입구. 멤버 1명 팀이면 초대, 개인 달력을 보고 있고 팀이 하나도 없으면 시작. 그 밖은 null */
export function togetherHintOf(group: GroupDetail | null, groups: GroupSummary[] | null): TogetherHintKind | null {
  if (!group) return null;
  if (group.type === "TEAM") return group.members.length <= 1 ? { kind: "invite", groupId: group.id } : null;
  if (!groups) return null;
  return groups.some((g) => g.type === "TEAM") ? null : { kind: "start" };
}

const link = "inline-flex h-10 shrink-0 items-center gap-0.5 font-medium text-acc-ink hover:underline underline-offset-2";

export function TogetherHint({ hint }: { hint: TogetherHintKind }) {
  const key = hint.kind === "invite" ? `invite.${hint.groupId}` : "start";
  const dismissed = useHintDismissed(key);
  if (dismissed) return null;
  return (
    <>
      <div className="flex h-10 items-center gap-2 text-[13px]">
        <IconTeam size={16} className="shrink-0 text-acc-ink" />
        {hint.kind === "invite" ? (
          <>
            <span className="min-w-0 truncate text-soft">아직 나 혼자예요</span>
            <Link href={teamHref({ invite: true })} className={link}>
              초대하기
              <IconChevronRight size={14} />
            </Link>
          </>
        ) : (
          <span className="flex min-w-0 items-center gap-3 overflow-hidden">
            <Link href="/groups/new" className={link}>
              같이 쓸 팀 만들기
              <IconChevronRight size={14} />
            </Link>
            <Link href="/join" className={link}>
              초대 코드 입력
              <IconChevronRight size={14} />
            </Link>
          </span>
        )}
        <button
          type="button"
          onClick={() => dismissHint(key)}
          aria-label="안내 닫기"
          className="hit -mr-1.5 ml-auto grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
        >
          <IconClose size={14} />
        </button>
      </div>
      <div aria-hidden="true" className="h-px bg-line" />
    </>
  );
}
