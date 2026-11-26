"use client";
// (#189) 약속 투표 `/polls/<코드>` (설계 약속-투표.md 5-3, 디자인규칙.md 5장).
// 머리줄 ‹ + 제목 + ⋯(투표 취소) → 누가 열었는지, 마감, 응답 수 → 후보 카드(날짜, 시각 15/600, 가능한 사람 아바타 줄, 오른쪽 "가능" 44)
// → 맨 아래 전체 폭 "이 시간으로 정하기" (카드를 하나 고르면 켜진다). 정한 뒤에는 "일정 보기".
// 표는 바로 저장하고 화면에 먼저 그린다(낙관적). 다른 사람이 먼저 정했으면(409) 다시 불러오고 서버 문구로 알린다
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { AvatarStack } from "@/components/Participants";
import { useToast } from "@/components/Toast";
import { IconCheck, IconChevronLeft, IconMore, IconPoll } from "@/components/icons";
import { Button, ConfirmDialog, EmptyState, ErrorState, Sheet, SkeletonList } from "@/components/ui";
import { messageOf, useConfirmPoll, useDeletePoll, usePoll, useRefetchOnVisible, useVotePoll, type ApiFailure } from "@/hooks";
import { deadlineText, defaultPick, optionLabel, optionParts, toggledVotes, topOptionIds, voterCountOf } from "@/lib/poll";
import { CALENDAR_PATH, eventHref } from "@/lib/routes";
import type { Member, Poll, PollOption } from "@/lib/types";

/** 낙관적 표: 내 표를 바꾼 결과를 화면 데이터에 먼저 반영 */
function withMyVotes(poll: Poll, votes: number[], me: Member): Poll {
  const on = new Set(votes);
  return {
    ...poll,
    myVotes: votes,
    options: poll.options.map((o) => {
      const others = o.voters.filter((v) => v.userId !== me.userId);
      return { ...o, voters: on.has(o.id) ? [...others, me] : others };
    }),
  };
}

export function PollScreen({ code, initial }: { code: string; initial?: Poll | null }) {
  const { groupId, group, eventsChanged } = useGroupContext();
  const router = useRouter();
  const toast = useToast();
  const q = usePoll(code, { initialData: initial ?? null });
  useRefetchOnVisible(q.refetch);
  const poll = q.data;
  const me = group?.me ?? null;
  const voteM = useVotePoll(groupId);
  const confirmM = useConfirmPoll(groupId, { keepPendingAfterSuccess: true });
  const deleteM = useDeletePoll(groupId, { keepPendingAfterSuccess: true });
  const [picked, setPicked] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<"confirm" | "cancel" | null>(null);

  // 고른 후보가 없으면 표가 가장 많은 후보 하나(동률이면 없음)
  const pick = poll && picked !== null && poll.options.some((o) => o.id === picked && !o.past) ? picked : poll ? defaultPick(poll) : null;

  /** 409(먼저 정함, 마감) 는 다시 불러오고 서버 문구로. 그 밖은 토스트 */
  function fail(error: ApiFailure, fallback: string) {
    if (error.status === 409 || error.code === "POLL_OPTION_PAST") void q.refetch();
    toast.show(error.code === "POLL_CLOSED" && error.message === "이미 정해진 투표예요" ? "이미 정해졌어요" : messageOf(error, fallback));
  }

  async function vote(option: PollOption, on: boolean) {
    if (!poll || !me) return;
    const before = poll;
    const votes = toggledVotes(poll.myVotes, option.id, on);
    q.setData(withMyVotes(poll, votes, me));
    const r = await voteM.mutate({ pollId: poll.id, optionIds: votes });
    if (r.ok) q.setData(r.data);
    else {
      q.setData(before);
      fail(r.error, "저장하지 못했어요. 다시 시도해 주세요");
    }
  }

  async function confirm() {
    if (!poll || pick === null) return;
    setDialog(null);
    const r = await confirmM.mutate({ pollId: poll.id, optionId: pick });
    if (!r.ok) {
      fail(r.error, "정하지 못했어요. 다시 시도해 주세요");
      return;
    }
    eventsChanged();
    toast.show(r.data.warning === "BUSY_NOW" ? "그 사이 이 시간에 일정이 생긴 사람이 있어요. 일정은 만들었어요" : "일정을 만들었어요");
    router.push(eventHref(r.data.event));
  }

  async function cancel() {
    if (!poll) return;
    const r = await deleteM.mutate(poll.id);
    setDialog(null);
    if (!r.ok && r.error.status !== 404) {
      fail(r.error, "취소하지 못했어요. 다시 시도해 주세요");
      return;
    }
    toast.show("투표를 취소했어요");
    router.push(CALENDAR_PATH);
  }

  if (q.error?.status === 404) {
    return (
      <div className="pt-1">
        <EmptyState icon={<IconPoll size={20} />} title="취소됐거나 찾을 수 없는 투표예요" className="mt-3 py-6">
          <Link href={CALENDAR_PATH} className="font-bold text-btn">
            달력으로
          </Link>
        </EmptyState>
      </div>
    );
  }

  const open = poll?.status === "OPEN";
  const closed = poll?.status === "CLOSED";
  const canVoteNow = Boolean(poll && open && !poll.expired && poll.canVote);
  const top = poll ? topOptionIds(poll.options) : [];
  const decided = poll?.options.find((o) => o.id === poll.decidedOptionId) ?? null;
  const isCreator = poll !== null && me !== null && poll.creator.userId === me.userId;
  const deadline = poll ? deadlineText(poll) : null;
  const pickedOption = poll?.options.find((o) => o.id === pick) ?? null;

  return (
    <div className="flex min-h-full flex-col pt-1">
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push(CALENDAR_PATH))}
          aria-label="뒤로"
          className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-sm text-ink hover:bg-hover"
        >
          <IconChevronLeft size={22} />
        </button>
        <h1 className="t-title min-w-0 flex-1 truncate">{poll?.title ?? ""}</h1>
        {open && (
          <button
            type="button"
            onClick={() => setMenu(true)}
            aria-haspopup="dialog"
            aria-label="투표 메뉴"
            className="-mr-2.5 grid size-11 shrink-0 place-items-center rounded-sm text-ink hover:bg-hover"
          >
            <IconMore size={22} />
          </button>
        )}
      </div>

      {poll && (
        <p className="t-sub mt-0.5">
          {poll.creator.displayName}님이 연 투표{deadline ? `, ${deadline}` : ""}
        </p>
      )}

      <div className="mt-3 flex-1">
        {q.error ? (
          <ErrorState message={messageOf(q.error, "투표를 불러오지 못했어요")} onRetry={q.refetch} />
        ) : !poll ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            {/* 상태 한 줄: 정함 / 마감 / 대상 아님 / 응답 수 */}
            <div className="rounded-xl bg-paper px-4 py-3 text-[14px] leading-5" role="status">
              {closed ? (
                <span>
                  <b className="font-bold text-acc-ink">{decided ? optionLabel(decided) : "시간"}</b>
                  {decided ? "으로 정했어요" : "을 정했어요"}
                </span>
              ) : poll.expired ? (
                <span>투표가 끝났어요. 후보를 하나 골라 정해 주세요</span>
              ) : (
                <span>
                  {poll.participants.members.length}명 중 <b className="font-bold">{voterCountOf(poll)}명</b>이 답했어요.{" "}
                  {poll.canVote ? "되는 시간을 모두 켜 주세요" : "이 투표의 대상이 아니라서 결과만 볼 수 있어요"}
                </span>
              )}
            </div>

            <ul className="mt-3 space-y-2" aria-label="후보 시간">
              {poll.options.map((o) => (
                <OptionCard
                  key={o.id}
                  option={o}
                  mine={poll.myVotes.includes(o.id)}
                  top={open && top.includes(o.id)}
                  decided={closed && o.id === poll.decidedOptionId}
                  selectable={open && !o.past}
                  selected={open && pick === o.id}
                  canVote={canVoteNow && !o.past}
                  busy={voteM.isPending}
                  onSelect={() => setPicked(o.id)}
                  onVote={(on) => void vote(o, on)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* 맨 아래 주 버튼. 폰은 독과 + 가 숨는다(AppShell) */}
      {poll && (
        <div className="sticky bottom-0 -mx-5 mt-4 bg-surface px-5 pb-[calc(12px+var(--sab))] pt-2 fold:-mx-1 fold:px-1 fold:pb-1">
          {closed ? (
            poll.eventCode ? (
              <Link
                href={eventHref({ publicCode: poll.eventCode })}
                className="flex h-12 w-full items-center justify-center rounded-md bg-btn text-[15px] font-bold text-on-btn hover:brightness-95"
              >
                일정 보기
              </Link>
            ) : (
              <p className="py-3 text-center text-[13px] text-ink-2">정해서 만든 일정이 지워졌어요</p>
            )
          ) : (
            <Button size="xl" full disabled={pick === null} loading={confirmM.isPending} onClick={() => (isCreator ? void confirm() : setDialog("confirm"))}>
              {pick === null ? "정할 시간을 골라 주세요" : "이 시간으로 정하기"}
            </Button>
          )}
        </div>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={poll?.title ?? "투표"}>
        <div className="flex flex-col gap-1.5 pb-1">
          <Button
            variant="danger"
            size="lg"
            full
            onClick={() => {
              setMenu(false);
              setDialog("cancel");
            }}
          >
            투표 취소
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={dialog === "confirm"}
        title="이 시간으로 정할까요?"
        body={pickedOption && poll ? `${optionLabel(pickedOption)}에 '${poll.title}' 일정이 생기고 투표는 끝나요` : undefined}
        confirmLabel="정하기"
        loading={confirmM.isPending}
        onConfirm={() => void confirm()}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        title="투표를 취소할까요?"
        body="후보와 표가 모두 지워져요"
        confirmLabel="취소하기"
        cancelLabel="닫기"
        danger
        loading={deleteM.isPending}
        onConfirm={() => void cancel()}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

/**
 * 후보 카드: 왼쪽(누르면 정할 후보로 고름) 날짜 12 + 시각 15/600 + 가능한 사람 아바타와 이름,
 * 오른쪽 "가능" 44 (켜면 `--btn` 면 + 체크). 고른 카드는 먹색 2px 테두리, 지난 후보는 흐리게
 */
function OptionCard({
  option,
  mine,
  top,
  decided,
  selectable,
  selected,
  canVote,
  busy,
  onSelect,
  onVote,
}: {
  option: PollOption;
  mine: boolean;
  top: boolean;
  decided: boolean;
  selectable: boolean;
  selected: boolean;
  canVote: boolean;
  busy: boolean;
  onSelect: () => void;
  onVote: (on: boolean) => void;
}) {
  const { date, time } = optionParts(option);
  const names = option.voters.map((v) => v.displayName).join(", ");
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold leading-4 text-ink-2">
        {date}
        {top && <span className="text-acc-ink">가장 많아요</span>}
        {decided && <span className="text-acc-ink">정한 시간</span>}
        {option.past && <span>지난 시간</span>}
      </span>
      <b className="mt-0.5 block text-[15px] font-semibold leading-5 tabular-nums">{time}</b>
      <span className="mt-1.5 flex min-h-5 items-center gap-1.5">
        <AvatarStack members={option.voters} size={20} max={5} />
        <span className="min-w-0 truncate text-[12px] leading-4 text-ink-2">{option.voters.length ? `${names} 가능` : "아직 없어요"}</span>
      </span>
    </>
  );
  return (
    <li className={`flex items-stretch gap-2 rounded-xl bg-paper py-1 pl-1 pr-2 ${selected ? "outline-2 outline-ink" : ""} ${option.past ? "opacity-55" : ""}`}>
      {selectable ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          aria-label={`${date} ${time}, 가능 ${option.voters.length}명${names ? ` (${names})` : ""}. 정할 시간으로 고르기`}
          className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left hover:bg-hover"
        >
          {body}
        </button>
      ) : (
        <div className="min-w-0 flex-1 px-3 py-2.5">{body}</div>
      )}
      {canVote && (
        <button
          type="button"
          aria-pressed={mine}
          disabled={busy}
          onClick={() => onVote(!mine)}
          aria-label={`${date} ${time} 가능`}
          className={`my-auto flex h-11 shrink-0 items-center gap-1 rounded-full px-3.5 text-[13px] font-bold ${
            mine ? "bg-btn text-on-btn" : "bg-surface text-ink hover:brightness-95"
          }`}
        >
          {mine && <IconCheck size={14} strokeWidth={2.6} />}
          가능
        </button>
      )}
    </li>
  );
}
