"use client";
// (#189) 투표 만들기 시트 (설계 약속-투표.md 5-1). 빈 시간 화면에서 고른 구간으로 연다.
// 제목(정하면 일정 제목) → 후보(구간마다 시작 시각을 구간 안에서 고른다, 길이는 최소 길이) + 직접 추가(날짜, 시각 또는 종일)
// → 마감(없음 / 내일 / 직접) → 대상(일정 참여자 시트 재사용, 기본 모두) → [투표 만들기]
import { useMemo, useState } from "react";
import { DatePicker, TimePicker } from "./pickers";
import { minutesOf } from "./pickers/time";
import { ParticipantSheet, ParticipantValue } from "./Participants";
import { IconClock, IconClose, IconPlus, IconTeam } from "./icons";
import { NameField } from "./NameField";
import { Button, InlineError, RowButton, RowGroup, Segmented, Sheet, Toggle } from "./ui";
import { messageOf, useCreatePoll } from "@/hooks";
import { addDays, kstToIso, timeOf, todayKey } from "@/lib/date";
import {
  candidateFromSlot,
  deadlineOf,
  draftProblem,
  hasOption,
  manualOption,
  MAX_POLL_OPTIONS,
  optionLabel,
  POLL_TITLE_MAX,
  slotKey,
  sortOptions,
  startRange,
  tomorrowDeadline,
  instantLabel,
  type DeadlineMode,
  type Slot,
} from "@/lib/poll";
import { participantsFromPick, type ParticipantPick } from "@/lib/participants";
import type { ClientSource } from "@/lib/assistant";
import type { Member, Poll, PollOptionInput } from "@/lib/types";

type Candidate = { key: string; slot: Slot | null; option: PollOptionInput };

export function PollCreateSheet({
  open,
  onClose,
  groupId,
  members,
  meId,
  slots,
  minMinutes,
  onCreated,
  initialTitle,
  initialParticipants,
  clientSource,
}: {
  open: boolean;
  onClose: () => void;
  groupId: number;
  members: readonly Member[];
  meId: number | null;
  /** 빈 시간 화면에서 고른 구간 (고른 순서) */
  slots: readonly Slot[];
  minMinutes: number;
  onCreated: (poll: Poll) => void;
  /** (#450) AI 비서 투표 초안 [고치기]: 제목, 대상을 채워 연다 (빈 시간 화면은 주지 않는다, D-273) */
  initialTitle?: string;
  initialParticipants?: number[];
  /** (#450) 만들기 요청의 X-Client-Source (AI 비서에서 연 경우 assistant-edit) */
  clientSource?: ClientSource;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="투표 만들기" tone="bg">
      {/* 열 때마다 고른 구간으로 다시 시작한다 */}
      {open && (
        <Body
          groupId={groupId}
          members={members}
          meId={meId}
          slots={slots}
          minMinutes={minMinutes}
          onCreated={onCreated}
          initialTitle={initialTitle}
          initialParticipants={initialParticipants}
          clientSource={clientSource}
        />
      )}
    </Sheet>
  );
}

function Body({
  groupId,
  members,
  meId,
  slots,
  minMinutes,
  onCreated,
  initialTitle = "",
  initialParticipants,
  clientSource,
}: {
  groupId: number;
  members: readonly Member[];
  meId: number | null;
  slots: readonly Slot[];
  minMinutes: number;
  onCreated: (poll: Poll) => void;
  initialTitle?: string;
  initialParticipants?: number[];
  clientSource?: ClientSource;
}) {
  const today = todayKey();
  const [title, setTitle] = useState(initialTitle);
  const [candidates, setCandidates] = useState<Candidate[]>(() =>
    slots.map((slot) => ({ key: slotKey(slot), slot, option: candidateFromSlot(slot, minMinutes) })),
  );
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState({ date: addDays(today, 1), allDay: false, start: "19:00", end: "21:00" });
  const [manualError, setManualError] = useState<string | null>(null);
  const [mode, setMode] = useState<DeadlineMode>("none");
  const [custom, setCustom] = useState({ date: addDays(today, 1), time: "21:00" });
  // (#442) 기본은 지금 멤버 전원(id 목록). "ALL" 로 보내지 않는다
  // (#450) AI 비서 초안이면 그 대상 중 지금 멤버만 (남는 게 없으면 전원)
  const [pick, setPick] = useState<ParticipantPick>(() => {
    const all = members.map((m) => m.userId).filter((id): id is number => id !== null);
    const kept = initialParticipants?.filter((id) => all.includes(id)) ?? [];
    return kept.length ? kept : all;
  });
  const [pickOpen, setPickOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useCreatePoll(groupId, { keepPendingAfterSuccess: true, source: clientSource ?? null });

  const options = useMemo(() => sortOptions(candidates.map((c) => c.option)), [candidates]);
  const full = candidates.length >= MAX_POLL_OPTIONS;
  const tomorrowLabel = useMemo(() => instantLabel(tomorrowDeadline(), today), [today]);

  function moveStart(key: string, slot: Slot, start: string) {
    const iso = kstToIso(startRange(slot, minMinutes).day, start);
    setCandidates((list) => list.map((c) => (c.key === key ? { ...c, option: candidateFromSlot(slot, minMinutes, iso) } : c)));
  }

  function addManual() {
    const option = manualOption(manual);
    if (!manual.allDay && (minutesOf(manual.end) ?? 0) <= (minutesOf(manual.start) ?? 0)) {
      setManualError("끝나는 시각은 시작보다 뒤여야 해요");
      return;
    }
    if (Date.parse(option.startsAt) <= Date.now()) {
      setManualError("이미 지난 시간은 후보로 고를 수 없어요");
      return;
    }
    if (hasOption(options, option)) {
      setManualError("이미 있는 후보예요");
      return;
    }
    setCandidates((list) => [...list, { key: `m:${option.startsAt}|${option.endsAt}`, slot: null, option }]);
    setManualError(null);
    setAdding(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = draftProblem({ title, options });
    const deadline = deadlineOf(mode, custom);
    if (problem) return setError(problem);
    if (deadline && Date.parse(deadline) <= Date.now()) return setError("마감은 지금 이후로 골라 주세요");
    setError(null);
    const r = await create.mutate({ title: title.trim(), options, deadline, participants: pick });
    if (!r.ok) {
      setError(messageOf(r.error, "투표를 만들지 못했어요. 다시 시도해 주세요"));
      return;
    }
    onCreated(r.data);
  }

  const problem = draftProblem({ title, options });

  return (
    <form onSubmit={submit} className="space-y-2 pb-1">
      {/* (#378) 제목 큰 칸(라벨은 읽기 이름에만), 후보는 한 줄씩(누르면 시작 시각 고치기) + 같은 카드의 "직접 추가", 마감 세그먼트와 대상 줄 */}
      <RowGroup>
        <NameField
          id="poll-title"
          label="제목 (정하면 일정 이름이 돼요)"
          value={title}
          onChange={setTitle}
          max={POLL_TITLE_MAX}
          limitInput
          placeholder="예: 저녁 약속"
          autoComplete="off"
        />
      </RowGroup>

      <RowGroup>
        <h3 className="pb-1 pt-2.5 text-[13px] font-semibold leading-[18px] text-ink-2">후보 {candidates.length}개</h3>
        {candidates.map((c) => {
          const range = c.slot ? startRange(c.slot, minMinutes) : null;
          const label = optionLabel(c.option, today);
          const text = <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 tabular-nums">{label}</span>;
          return (
            <div key={c.key} className="flex min-h-11 items-center gap-1">
              {/* 구간이 최소 길이보다 길면 줄을 눌러 그 안에서 시작 시각을 고른다 (기본은 구간 시작) */}
              {c.slot && range && range.to > range.from ? (
                <TimePicker
                  look="row"
                  label={`${label}, 시작 시각`}
                  value={timeOf(c.option.startsAt)}
                  from={range.from}
                  to={range.to}
                  onChange={(v) => moveStart(c.key, c.slot as Slot, v)}
                  className="min-w-0 flex-1"
                  display={
                    <>
                      {text}
                      <IconClock size={16} className="shrink-0 text-ink-2" />
                    </>
                  }
                />
              ) : (
                <span className="flex min-h-11 min-w-0 flex-1 items-center">{text}</span>
              )}
              <button
                type="button"
                onClick={() => setCandidates((list) => list.filter((x) => x.key !== c.key))}
                aria-label={`${label} 후보 빼기`}
                className="-mr-2 grid size-10 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover"
              >
                <IconClose size={16} />
              </button>
            </div>
          );
        })}

        {adding ? (
          <div role="group" aria-label="후보 직접 추가" className="space-y-2 py-2.5">
            <div className="flex items-center gap-2">
              <DatePicker look="chip" label="후보 날짜" value={manual.date} min={today} onChange={(date) => setManual((m) => ({ ...m, date }))} />
              <div className="ml-auto">
                <Toggle checked={manual.allDay} onChange={(allDay) => setManual((m) => ({ ...m, allDay }))} label="종일" />
              </div>
            </div>
            {!manual.allDay && (
              <div className="flex items-center gap-1.5">
                <TimePicker look="chip" label="후보 시작 시각" value={manual.start} to={23 * 60 + 30} onChange={(start) => setManual((m) => ({ ...m, start }))} />
                <span aria-hidden="true" className="text-ink-2">
                  ~
                </span>
                <TimePicker look="chip" label="후보 끝 시각" value={manual.end} from={30} allow24 onChange={(end) => setManual((m) => ({ ...m, end }))} />
              </div>
            )}
            {manualError && <InlineError>{manualError}</InlineError>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                닫기
              </Button>
              <Button variant="ink" size="sm" onClick={addManual}>
                후보에 넣기
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={full}
            onClick={() => {
              setManualError(null);
              setAdding(true);
            }}
            className="flex min-h-11 w-full items-center gap-1.5 text-[14px] font-bold text-btn disabled:font-medium disabled:text-ink-2"
          >
            <IconPlus size={16} strokeWidth={2.2} />
            {full ? `후보는 ${MAX_POLL_OPTIONS}개까지예요` : "직접 추가"}
          </button>
        )}
      </RowGroup>

      <RowGroup hint="마감이 지나면 내게 알려 드려요. 시간은 직접 정해요">
        <div className="pb-3 pt-2.5">
          <h3 id="poll-deadline" className="mb-2 text-[14px] font-semibold">
            마감
          </h3>
          <Segmented
            labelledBy="poll-deadline"
            value={mode}
            onChange={setMode}
            options={[
              { value: "none", label: "없음" },
              { value: "tomorrow", label: "내일" },
              { value: "custom", label: "직접" },
            ]}
          />
          {mode === "tomorrow" && <p className="t-sub mt-1.5">{tomorrowLabel}까지 받아요</p>}
          {mode === "custom" && (
            <div className="mt-2 flex justify-end gap-1.5">
              <DatePicker look="chip" label="마감 날짜" value={custom.date} min={today} onChange={(date) => setCustom((d) => ({ ...d, date }))} />
              <TimePicker look="chip" label="마감 시각" value={custom.time} onChange={(time) => setCustom((d) => ({ ...d, time }))} />
            </div>
          )}
        </div>
        <RowButton label="대상" icon={<IconTeam size={18} />} onClick={() => setPickOpen(true)} aria-haspopup="dialog">
          <ParticipantValue value={participantsFromPick(pick, members)} meId={meId} />
        </RowButton>
      </RowGroup>

      {error && <InlineError>{error}</InlineError>}
      <div className="pt-1">
        <Button type="submit" size="xl" full disabled={problem !== null} loading={create.isPending}>
          {problem && candidates.length < 2 ? "후보를 2개 이상 골라 주세요" : "투표 만들기"}
        </Button>
      </div>

      <ParticipantSheet
        open={pickOpen}
        members={members}
        meId={meId}
        value={pick}
        onDone={(v) => {
          setPick(v);
          setPickOpen(false);
        }}
        onClose={() => setPickOpen(false)}
      />
    </form>
  );
}
