"use client";
// 일정 상세의 참석 여부와 짧은 반응 (#190, 설계 docs/설계/참석-여부.md 7장)
//   RsvpBlock:      참여자 줄 바로 아래. 내 참석 세그먼트(참여자만) + 집계 한 줄(누르면 사람별 시트)
//                   (#378) 고른 칸은 먹색으로 칠하고 "내 참석" 옆에 "참석함" 처럼 적는다 (예전 세그먼트는 칸 바탕과 같은 색이라 고른 칸이 안 보였다)
//   between:        (#378) 참석과 반응 사이에 끼울 칸 (일정 상세의 메모: 시간 → 장소 → 참여자, 참석 → 메모 → 반응)
//   ReactionRow:    글자 알약 3개 "좋아요 2". 팀원 누구나, 내 반응은 --ink 테두리, 다시 누르면 취소
// 목록 응답의 집계로 바로 그리고, 사람별 목록은 단건 GET(rsvpMembers)으로 받는다. 개인 팀은 부르는 쪽이 숨긴다
import { useId, useState } from "react";
import { IconCheck } from "./icons";
import { Avatar, InlineError, RowButton, Sheet } from "./ui";
import { useToast } from "./Toast";
import { messageOf, useEvent, useSetReaction, useSetRsvp } from "@/hooks";
import {
  REACTION_OPTIONS,
  RSVP_LABEL,
  RSVP_OPTIONS,
  applyMyReaction,
  applyMyRsvp,
  isParticipant,
  nextReaction,
  occurrenceQuery,
  rsvpSummaryText,
  EMPTY_REACTIONS,
} from "@/lib/rsvp";
import type { Event, EventDetailData, Member, Reaction, ReactionMember, ReactionSummary, Rsvp, RsvpMember, RsvpSummary } from "@/lib/types";

const NOT_PARTICIPANT_TOAST = "이 일정의 참여자가 아니라서 응답할 수 없어요";

export function EventResponses({
  event: ev,
  groupId,
  meId,
  showRsvp,
  onChanged,
  between,
}: {
  event: Event;
  groupId: number;
  meId: number | null;
  /** 참여자 줄을 그리는지 (참여자 0명이면 응답 줄도 없다) */
  showRsvp: boolean;
  /** 응답이 바뀌면 목록(다가오는 일정의 "응답" 표시)을 다시 받게 */
  onChanged?: () => void;
  /** (#378) 참석 칸과 반응 줄 사이 (메모) */
  between?: React.ReactNode;
}) {
  const toast = useToast();
  const occurrence = occurrenceQuery(ev);
  const detail = useEvent(groupId, ev.id, occurrence ?? null);
  // 화면 값: 내가 방금 바꾼 값(ov) > 단건 응답(가장 최신) > 목록 응답. ov 는 그때의 단건 응답에 묶여 있어 단건을 새로 받으면 버린다
  const fresh = detail.data;
  const [ov, setOv] = useState<{ base: EventDetailData | null; rsvp?: RsvpSummary; reactions?: ReactionSummary }>({ base: null });
  const live = ov.base === fresh;
  const rsvp = (live ? ov.rsvp : undefined) ?? fresh?.rsvp ?? ev.rsvp;
  const reactions = (live ? ov.reactions : undefined) ?? fresh?.reactions ?? ev.reactions ?? EMPTY_REACTIONS;
  const override = (patch: { rsvp?: RsvpSummary; reactions?: ReactionSummary }) => setOv((o) => ({ ...(o.base === fresh ? o : {}), base: fresh, ...patch }));
  const [sheetOpen, setSheetOpen] = useState(false);
  const setRsvpM = useSetRsvp(groupId);
  const setReactionM = useSetReaction(groupId);
  const [error, setError] = useState<string | null>(null);

  const mine = rsvp?.mine ?? null;
  const canRespond = showRsvp && rsvp !== undefined && isParticipant(ev, meId);
  const myRow = fresh?.rsvpMembers?.find((row) => row.member.userId === meId);
  const segId = useId();

  async function pickRsvp(next: Rsvp) {
    if (!rsvp || next === mine || setRsvpM.isPending) return;
    setError(null);
    override({ rsvp: applyMyRsvp(rsvp, next) });
    const r = await setRsvpM.mutate({ eventId: ev.id, occurrence, status: next });
    if (r.ok) {
      override({ rsvp: r.data });
      void detail.refetch();
      onChanged?.();
      return;
    }
    override({ rsvp: undefined });
    if (r.error.code === "NOT_PARTICIPANT") {
      // 그사이 참여자에서 빠졌다. 상세와 목록을 새로 받아 세그먼트를 숨긴다
      toast.show(NOT_PARTICIPANT_TOAST);
      void detail.refetch();
      onChanged?.();
      return;
    }
    setError(messageOf(r.error, "저장하지 못했어요. 다시 시도해 주세요"));
  }

  async function pressReaction(pressed: Reaction) {
    if (setReactionM.isPending) return;
    const next = nextReaction(reactions.mine, pressed);
    override({ reactions: applyMyReaction(reactions, next) });
    const r = await setReactionM.mutate({ eventId: ev.id, occurrence, reaction: next });
    if (r.ok) {
      override({ reactions: r.data });
      void detail.refetch();
      return;
    }
    override({ reactions: undefined });
    toast.show(messageOf(r.error, "반응을 남기지 못했어요. 다시 시도해 주세요"));
  }

  return (
    <>
      {showRsvp && rsvp && (
        <div className="mt-2 rounded-sm bg-surface px-3.5 py-2.5">
          {canRespond && (
            <>
              <div className="mb-1.5 flex items-center gap-1.5">
                <small id={segId} className="text-[12px] leading-4 text-ink-2">
                  내 참석
                </small>
                {mine && <b className="text-[12px] font-bold leading-4 text-ink">{MINE_TEXT[mine]}</b>}
              </div>
              <RsvpSegment labelledBy={segId} value={mine} onChange={(v) => void pickRsvp(v)} />
              {myRow?.stale && mine && <p className="mt-1.5 text-[12px] leading-4 text-ink-2">답한 뒤에 시간이 바뀌었어요. 다시 골라 주세요</p>}
              {error && <InlineError className="mt-1.5">{error}</InlineError>}
            </>
          )}
          <RowButton
            label={canRespond ? "모두의 응답" : "참석 여부"}
            value={rsvpSummaryText(rsvp)}
            onClick={() => setSheetOpen(true)}
            className={canRespond ? "mt-1" : ""}
            aria-haspopup="dialog"
          />
        </div>
      )}
      {between}
      <ReactionRow summary={reactions} onPress={(k) => void pressReaction(k)} />
      <ResponsesSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        loading={!fresh}
        rsvpMembers={fresh?.rsvpMembers ?? []}
        reactionMembers={fresh?.reactionMembers ?? []}
        meId={meId}
      />
    </>
  );
}

/** "내 참석" 옆 한 마디 */
const MINE_TEXT: Record<Rsvp, string> = { GOING: "참석함", MAYBE: "미정", NOT_GOING: "불참함" };

/**
 * (#378) 내 참석 세 칸. 칸 바탕(--surface) 위에 흰 칸 셋을 두고, 고른 칸만 먹색 면 + 흰 글자 + 체크.
 * 공통 Segmented 는 고른 칸이 흰 면이라 이 회색 칸 안에서는 고른 칸이 잘 안 보인다 (나머지 화면 점검 1)
 */
function RsvpSegment({ labelledBy, value, onChange }: { labelledBy: string; value: Rsvp | null; onChange: (v: Rsvp) => void }) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-3 gap-1.5">
      {RSVP_OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`anim-pick flex h-10 items-center justify-center gap-1 rounded-sm border text-[14px] ${
              on ? "border-ink bg-ink font-bold text-paper" : "border-line bg-paper font-medium text-soft hover:text-ink"
            }`}
          >
            {on && <IconCheck size={14} strokeWidth={2.4} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 글자 알약 3개 (13/500, 모서리 999). 내 반응은 --ink 테두리 + 굵게. 코랄 면은 쓰지 않는다 (디자인규칙 1-3, 7) */
function ReactionRow({ summary, onPress }: { summary: ReactionSummary; onPress: (k: Reaction) => void }) {
  return (
    <div role="group" aria-label="반응 남기기" className="mt-2 flex flex-wrap gap-1.5">
      {REACTION_OPTIONS.map((o) => {
        const on = summary.mine === o.value;
        const n = summary[o.value];
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-label={`${o.label}${n ? ` ${n}명` : ""}`}
            onClick={() => onPress(o.value)}
            className={`hit inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] leading-none ${
              on ? "border-ink font-bold text-ink" : "border-line font-medium text-soft hover:text-ink"
            }`}
          >
            {o.label}
            {n > 0 && <span className="tabular-nums">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 사람별 응답 시트: 참석, 미정, 불참, 응답 전 순서로 묶고 그 아래 반응한 사람 */
function ResponsesSheet({
  open,
  onClose,
  loading,
  rsvpMembers,
  reactionMembers,
  meId,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  rsvpMembers: RsvpMember[];
  reactionMembers: ReactionMember[];
  meId: number | null;
}) {
  const groups: { key: string; title: string; rows: RsvpMember[] }[] = [
    ...RSVP_OPTIONS.map((o) => ({ key: o.value, title: RSVP_LABEL[o.value], rows: rsvpMembers.filter((r) => r.status === o.value) })),
    { key: "pending", title: "응답 전", rows: rsvpMembers.filter((r) => r.status === null) },
  ].filter((g) => g.rows.length > 0);
  const reactionLabel = (k: Reaction) => REACTION_OPTIONS.find((o) => o.value === k)?.label ?? "";
  return (
    <Sheet open={open} onClose={onClose} title="응답">
      {loading ? (
        <p className="py-4 text-[14px] text-ink-2">불러오는 중이에요</p>
      ) : (
        <div className="pb-1">
          {groups.map((g) => (
            <section key={g.key} className="mb-3">
              <h3 className="mb-1 text-[13px] font-bold leading-[18px] text-ink-2">
                {g.title} {g.rows.length}
              </h3>
              <ul className="space-y-1">
                {g.rows.map((r, i) => (
                  <PersonRow key={r.member.userId ?? `x${i}`} member={r.member} meId={meId} note={r.status && r.stale ? "시간이 바뀌기 전에 답했어요" : null} />
                ))}
              </ul>
            </section>
          ))}
          {reactionMembers.length > 0 && (
            <section className="mb-1 border-t border-line pt-3">
              <h3 className="mb-1 text-[13px] font-bold leading-[18px] text-ink-2">반응 {reactionMembers.length}</h3>
              <ul className="space-y-1">
                {reactionMembers.map((r, i) => (
                  <PersonRow key={r.member.userId ?? `x${i}`} member={r.member} meId={meId} value={reactionLabel(r.reaction)} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}

function PersonRow({ member, meId, note = null, value }: { member: Member; meId: number | null; note?: string | null; value?: string }) {
  return (
    <li className="flex min-h-10 items-center gap-2.5">
      <Avatar member={member} color={member.color} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-5">
          {member.displayName}
          {meId !== null && member.userId === meId ? " (나)" : ""}
        </span>
        {note && <span className="block text-[12px] leading-4 text-ink-2">{note}</span>}
      </span>
      {value && <span className="shrink-0 text-[13px] text-soft">{value}</span>}
    </li>
  );
}
