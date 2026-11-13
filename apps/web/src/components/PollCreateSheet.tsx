"use client";
// (#189) 투표 만들기 시트 (설계 약속-투표.md 5-1). 빈 시간 화면에서 고른 구간으로 연다.
// 제목(정하면 일정 제목) → 후보(구간마다 시작 시각을 구간 안에서 고른다, 길이는 최소 길이) + 직접 추가(날짜, 시각 또는 종일)
// → 마감(없음 / 내일 / 직접) → 대상(일정 참여자 시트 재사용, 기본 모두) → [투표 만들기]
import { useMemo, useState } from "react";
import { DatePicker, TimePicker } from "./pickers";
import { minutesOf } from "./pickers/time";
import { ParticipantSheet, ParticipantValue } from "./Participants";
import { IconClose, IconPlus } from "./icons";
import { Button, captionClass, InlineError, RowButton, Segmented, Sheet, titleInputClass, Toggle } from "./ui";
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
}) {
  return (
    <Sheet open={open} onClose={onClose} title="투표 만들기">
      {/* 열 때마다 고른 구간으로 다시 시작한다 */}
      {open && <Body groupId={groupId} members={members} meId={meId} slots={slots} minMinutes={minMinutes} onCreated={onCreated} />}
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
}: {
  groupId: number;
  members: readonly Member[];
  meId: number | null;
  slots: readonly Slot[];
  minMinutes: number;
  onCreated: (poll: Poll) => void;
}) {
  const today = todayKey();
  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>(() =>
    slots.map((slot) => ({ key: slotKey(slot), slot, option: candidateFromSlot(slot, minMinutes) })),
  );
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState({ date: addDays(today, 1), allDay: false, start: "19:00", end: "21:00" });
  const [manualError, setManualError] = useState<string | null>(null);
  const [mode, setMode] = useState<DeadlineMode>("none");
  const [custom, setCustom] = useState({ date: addDays(today, 1), time: "21:00" });
  const [pick, setPick] = useState<ParticipantPick>("ALL");
  const [pickOpen, setPickOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useCreatePoll(groupId, { keepPendingAfterSuccess: true });

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
    <form onSubmit={submit} className="space-y-4 pb-1">
      <div>
        <label htmlFor="poll-title" className={captionClass}>
          제목 (정하면 일정 이름이 돼요)
        </label>
        <input
          id="poll-title"
          className={titleInputClass}
          value={title}
          maxLength={POLL_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 저녁 약속"
          autoComplete="off"
        />
      </div>

      <div>
        <h3 className={captionClass}>후보 {candidates.length}개</h3>
        <ul className="space-y-1.5">
          {candidates.map((c) => {
            const range = c.slot ? startRange(c.slot, minMinutes) : null;
            return (
              <li key={c.key} className="rounded-md bg-surface px-3 py-2">
                <div className="flex min-h-9 items-center gap-2">
                  <span className="min-w-0 flex-1 text-[14px] font-semibold leading-5 tabular-nums">{optionLabel(c.option, today)}</span>
                  <button
                    type="button"
                    onClick={() => setCandidates((list) => list.filter((x) => x.key !== c.key))}
                    aria-label={`${optionLabel(c.option, today)} 후보 빼기`}
                    className="-mr-1.5 grid size-9 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover"
                  >
                    <IconClose size={16} />
                  </button>
                </div>
                {/* 구간이 최소 길이보다 길면 그 안에서 시작 시각을 고른다 (기본은 구간 시작) */}
                {c.slot && range && range.to > range.from && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="shrink-0 text-[12px] text-ink-2">시작</span>
                    <TimePicker
                      label="후보 시작 시각"
                      value={timeOf(c.option.startsAt)}
                      from={range.from}
                      to={range.to}
                      onChange={(v) => moveStart(c.key, c.slot as Slot, v)}
                      className="max-w-[160px]"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {adding ? (
          <div className="mt-2 space-y-2 rounded-md border border-line px-3 py-2.5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <DatePicker label="후보 날짜" value={manual.date} min={today} onChange={(date) => setManual((m) => ({ ...m, date }))} />
              <Toggle checked={manual.allDay} onChange={(allDay) => setManual((m) => ({ ...m, allDay }))} label="종일" />
            </div>
            {!manual.allDay && (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TimePicker label="후보 시작 시각" value={manual.start} to={23 * 60 + 30} onChange={(start) => setManual((m) => ({ ...m, start }))} />
                </div>
                <span aria-hidden="true" className="text-ink-2">
                  ~
                </span>
                <div className="min-w-0 flex-1">
                  <TimePicker label="후보 끝 시각" value={manual.end} from={30} allow24 onChange={(end) => setManual((m) => ({ ...m, end }))} />
                </div>
              </div>
            )}
            {manualError && <InlineError>{manualError}</InlineError>}
            <div className="flex gap-2">
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
            className="mt-1 flex h-11 items-center gap-1 text-[14px] font-bold text-btn disabled:text-ink-2"
          >
            <IconPlus size={16} strokeWidth={2.2} />
            {full ? `후보는 ${MAX_POLL_OPTIONS}개까지예요` : "직접 추가"}
          </button>
        )}
      </div>

      <div>
        <h3 id="poll-deadline" className={captionClass}>
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
          <div className="mt-2 grid grid-cols-2 gap-2">
            <DatePicker label="마감 날짜" value={custom.date} min={today} onChange={(date) => setCustom((d) => ({ ...d, date }))} />
            <TimePicker label="마감 시각" value={custom.time} onChange={(time) => setCustom((d) => ({ ...d, time }))} />
          </div>
        )}
        <p className="t-sub mt-1.5">마감이 지나면 내게 알려 드려요. 시간은 직접 정해요</p>
      </div>

      <div className="rounded-md bg-surface px-3">
        <RowButton label="대상" onClick={() => setPickOpen(true)} aria-haspopup="dialog">
          <ParticipantValue value={participantsFromPick(pick, members)} meId={meId} />
        </RowButton>
      </div>

      {error && <InlineError>{error}</InlineError>}
      <Button type="submit" size="xl" full disabled={problem !== null} loading={create.isPending}>
        {problem && candidates.length < 2 ? "후보를 2개 이상 골라 주세요" : "투표 만들기"}
      </Button>

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
