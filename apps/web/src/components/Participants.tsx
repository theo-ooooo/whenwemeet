"use client";
// 일정 참여자 (#248, 설계 7-2, 7-3) 화면 조각
//   DotCluster:       참여자 색 점 묶음 (최대 3 + "+"). PC 칩, 다가오는 일정 카드
//   AvatarStack:      겹친 아바타 (폼 참여자 줄)
//   ParticipantList:  일정 상세의 "참여자" 줄 (아바타 24 + 이름, 세로, 가입순)
//   ParticipantSheet: 폼의 참여자 고르기 (전체 선택 + 멤버 여러 명, #442). [완료] 로 닫을 때 반영
import { useMemo, useState } from "react";
import { useGroupContext } from "./AppShell";
import { IconCheck } from "./icons";
import { Avatar, Button, Sheet } from "./ui";
import { dotCluster, labelOf, participantsOf, type ParticipantPick, type Participants, type WhoContext } from "@/lib/participants";
import type { Event, Member } from "@/lib/types";

/** 지금 팀에서 사람 표기에 필요한 것 (내 id, 개인 팀 여부). 팀 정보를 받기 전에는 내 id 를 모르고 사람 표기를 둔다 */
export function useWho(): WhoContext {
  const { group } = useGroupContext();
  const meId = group?.me.userId ?? null;
  const personal = group?.type === "PERSONAL";
  return useMemo(() => ({ meId, personal }), [meId, personal]);
}

export function DotCluster({
  event,
  size = 5,
  gap = 2,
  plusClass = "text-[9px] font-bold leading-none text-ink-2",
  className = "",
}: {
  event: Pick<Event, "creator" | "participants" | "color">;
  size?: number;
  gap?: number;
  plusClass?: string;
  className?: string;
}) {
  const { dots, more } = dotCluster(event);
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center ${className}`} style={{ gap }}>
      {dots.map((c, i) => (
        <i key={i} className="block shrink-0 rounded-full" style={{ width: size, height: size, background: c }} />
      ))}
      {more && <b className={plusClass}>+</b>}
    </span>
  );
}

/** 겹친 아바타 (최대 max). 각 아바타에 바탕색 테두리를 둘러 겹친 자리를 가른다 */
export function AvatarStack({ members, size = 20, max = 3, ring = "var(--tile)" }: { members: readonly Member[]; size?: number; max?: number; ring?: string }) {
  if (members.length === 0) return null;
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center">
      {members.slice(0, max).map((m, i) => (
        <span
          key={m.userId ?? `x${i}`}
          className="inline-flex rounded-full"
          style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.3), boxShadow: `0 0 0 1.5px ${ring}` }}
        >
          <Avatar member={m} color={m.color} size={size} />
        </span>
      ))}
    </span>
  );
}

/** 일정 상세 참여자 줄. 가입순 목록 (전원이어도 같은 목록, #442), 참여자 없음이면 회색 안내 */
export function ParticipantList({ event, meId }: { event: Pick<Event, "creator" | "participants">; meId: number | null }) {
  const p = participantsOf(event);
  return (
    <div className="mt-2.5 rounded-sm bg-surface px-3.5 py-2.5">
      <small className="block text-[12px] leading-4 text-ink-2">참여자</small>
      {p.members.length === 0 ? (
        <p className="mt-1">
          <span className="block text-[14px] font-semibold leading-5 text-ink-2">참여자 없음</span>
          <span className="block text-[13px] leading-[18px] text-ink-2">수정에서 다시 고를 수 있어요</span>
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {p.members.map((m, i) => (
            <li key={m.userId ?? `x${i}`} className="flex min-h-6 items-center gap-2 text-[14px] leading-5">
              <Avatar member={m} color={m.color} size={24} />
              <span className="min-w-0 truncate">
                {m.displayName}
                {meId !== null && m.userId === meId ? " (나)" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 폼 참여자 줄 오른쪽: 겹친 아바타 + 표기. 참여자 없음은 회색 글자만 */
export function ParticipantValue({ value, meId }: { value: Participants; meId: number | null }) {
  const label = labelOf(value, meId);
  return (
    <span className="ml-auto flex min-w-0 items-center gap-2">
      <AvatarStack members={value.members} size={20} />
      <span className={`min-w-0 truncate text-[14px] ${value.members.length ? "text-soft" : "text-ink-2"}`}>{label}</span>
    </span>
  );
}

export function ParticipantSheet({
  open,
  members,
  meId,
  value,
  onDone,
  onClose,
}: {
  open: boolean;
  /** 그 팀 지금 멤버 (가입순) */
  members: readonly Member[];
  meId: number | null;
  value: ParticipantPick;
  onDone: (v: ParticipantPick) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="참여자">
      {/* 열 때마다 지금 값으로 다시 시작한다 (닫으면 고르던 값은 버림) */}
      {open && <SheetBody members={members} meId={meId} initial={value} onDone={onDone} />}
    </Sheet>
  );
}

function SheetBody({
  members,
  meId,
  initial,
  onDone,
}: {
  members: readonly Member[];
  meId: number | null;
  initial: ParticipantPick;
  onDone: (v: ParticipantPick) => void;
}) {
  // (#442) "모두" 줄 대신 멤버 목록 위 "전체 선택". 전원을 골라도 "ALL" 로 보내지 않고 고른 id 그대로 (사람 아바타로 보이게, 사용자 결정)
  // 지금 멤버가 아닌 id 는 처음부터 뺀다 (방금 나간 멤버, 7-3)
  const ids = members.map((m) => m.userId).filter((id): id is number => id !== null);
  const alive = new Set(ids);
  const [pick, setPick] = useState<number[]>(() => (initial === "ALL" ? ids : initial.filter((id) => alive.has(id))));
  const allOn = ids.length > 0 && ids.every((id) => pick.includes(id));
  const empty = pick.length === 0;
  const toggle = (id: number) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const row = "flex h-[52px] w-full items-center gap-3 rounded-md px-3 text-left hover:bg-hover";
  return (
    <div className="pb-1">
      <ul aria-label="참여자 고르기">
        <li>
          <button type="button" role="checkbox" aria-checked={allOn} onClick={() => setPick(allOn ? [] : ids)} className={row}>
            <span className={`min-w-0 flex-1 text-[15px] ${allOn ? "font-bold" : "font-medium"}`}>전체 선택</span>
            <Check on={allOn} />
          </button>
        </li>
        <li aria-hidden="true" className="mx-3 my-1 h-px bg-line" />
        {members.map((m, i) => {
          const id = m.userId;
          if (id === null) return null;
          const on = pick.includes(id);
          return (
            <li key={id ?? `x${i}`}>
              <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(id)} className={row}>
                <Avatar member={m} color={m.color} size={28} />
                <span className={`min-w-0 flex-1 truncate text-[15px] ${on ? "font-bold" : "font-medium"}`}>
                  {m.displayName}
                  {id === meId ? " (나)" : ""}
                </span>
                <Check on={on} />
              </button>
            </li>
          );
        })}
      </ul>
      {empty && (
        <p role="alert" className="mt-1 px-3 text-[13px] text-danger">
          한 명 이상 골라 주세요
        </p>
      )}
      <Button size="lg" full className="mt-3" disabled={empty} onClick={() => onDone(ids.filter((id) => pick.includes(id)))}>
        완료
      </Button>
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] ${on ? "border-btn bg-btn text-on-btn" : "border-line"}`}
    >
      {on && <IconCheck size={14} strokeWidth={2.6} />}
    </span>
  );
}
