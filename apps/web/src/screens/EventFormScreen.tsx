"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { IconChevronRight } from "@/components/icons";
import { ParticipantSheet, ParticipantValue } from "@/components/Participants";
import { RepeatSheet, ScopeSheet } from "@/components/RecurrenceSheets";
import { ReminderNote, ReminderSheet } from "@/components/ReminderPicker";
import { useToast } from "@/components/Toast";
import { haptic } from "@/lib/app-bridge";
import { DatePicker, TimePicker } from "@/components/pickers";
import { Button, ConfirmDialog, Field, MemberDot, Segmented, Skeleton, Toggle, inputClass, titleInputClass } from "@/components/ui";
import { messageOf, useCreateEvent, useDeleteEvent, useEvent, useUpdateEvent } from "@/hooks";
import { addDays, dateKeyOf, kstToIso, timeOf, todayKey } from "@/lib/date";
import { missingEventTarget } from "@/lib/calendar-url";
import { charCount, clampChars } from "@/lib/chars";
import { useLeaveGuard } from "@/lib/useLeaveGuard";
import { followingUntil, formRepeatOf, keepsLoadedTimes, repeatRuleError } from "@/lib/recurrence";
import { formRuleDate, repeatLabel } from "@/lib/recurrence-label";
import { maybeOpenPushPrompt } from "@/lib/push";
import { REMINDER_LABEL, reminderAfterAllDayChange, reminderError, reminderOf, reminderToSend } from "@/lib/reminder";
import {
  copyPick,
  normalizePick,
  participantsBody,
  participantsChanged,
  participantsFromPick,
  pickOf,
  samePick,
  showParticipantRow,
  type ParticipantPick,
} from "@/lib/participants";
import type { Event, EventInput, EventPatchInput, EventReminder, EventScope, Repeat } from "@/lib/types";

type Props = {
  groupId: number;
  eventId?: number;
  /** 복제할 일정 ID. 값만 채우고 새 일정으로 저장한다. 반복 회차를 복제해도 한 번짜리로 시작한다 (QA3-L2) */
  copyFrom?: number;
  /** 반복 일정의 회차 날짜 (?occurrence=, #187). 없으면 첫 회차 */
  occurrence?: string | null;
  /** 미리 정한 범위 (?scope=). 있으면 저장할 때 묻지 않고, "이 일정만" 이면 반복 줄을 숨긴다 */
  presetScope?: EventScope | null;
  initialStart?: string | null;
  initialEnd?: string | null;
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
// 서버 기준(코드포인트) 글자 수 (#63)
const TITLE_MAX = 50;
const MEMO_MAX = 500;

export function EventFormScreen({ groupId, eventId, copyFrom, occurrence, presetScope = null, initialStart, initialEnd }: Props) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(eventId);
  const sourceId = eventId ?? copyFrom;

  const defaultStart = initialStart ?? kstToIso(todayKey(), "10:00");
  const defaultEnd = initialEnd ?? kstToIso(todayKey(), "11:00");
  // 달력 빠른 추가의 "자세히"(#46) 가 넘긴 제목, 종일. 새 일정일 때만 쓴다
  const query = useSearchParams();
  const draftTitle = sourceId ? "" : clampChars(query.get("title") ?? "", TITLE_MAX);
  const draftAllDay = !sourceId && query.get("allDay") === "1";
  // 빠른 추가에서 고른 알림 (#188). 종일 여부와 맞지 않으면 없음
  const draftReminder = sourceId ? "NONE" : reminderAfterAllDayChange(reminderOf(query.get("reminder")), draftAllDay);

  // (#248) 참여자: 팀 멤버, 내 id, 개인 팀 여부는 AppShell 이 받은 팀 정보에서
  const { group } = useGroupContext();
  const meId = group?.me.userId ?? null;
  const personal = group?.type === "PERSONAL";

  const [loaded, setLoaded] = useState(!sourceId);
  const [creator, setCreator] = useState<Event["creator"] | null>(null);
  const [title, setTitle] = useState(draftTitle);
  const [allDay, setAllDay] = useState(draftAllDay);
  const [startDate, setStartDate] = useState(dateKeyOf(defaultStart));
  const [startTime, setStartTime] = useState(timeOf(defaultStart));
  const [endDate, setEndDate] = useState(dateKeyOf(defaultEnd));
  const [endTime, setEndTime] = useState(timeOf(defaultEnd));
  const [memo, setMemo] = useState("");
  // 반복 (#187). untilOn 이 false 면 "계속"
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [untilOn, setUntilOn] = useState(false);
  const [untilDate, setUntilDate] = useState("");
  const [repeatOpen, setRepeatOpen] = useState(false);
  // 알림 시각 (#188, 푸시-알림.md 4-1). 기본 없음, 종일을 바꾸면 맞지 않는 값은 없음으로
  const [reminder, setReminder] = useState<EventReminder>(draftReminder);
  const [reminderOpen, setReminderOpen] = useState(false);
  // 참여자 (#248, 7-3). null = 새 일정 기본값 "나". 수정은 응답 값, 복제는 원본 값(지금 멤버로 거른다)
  const [pick, setPick] = useState<ParticipantPick | null>(null);
  const [initialPick, setInitialPick] = useState<ParticipantPick | null>(null);
  const [participantOpen, setParticipantOpen] = useState(false);
  // 범위 시트 (저장/삭제), 고른 범위의 요청 중 표시, "이후 모두" 확인 창
  const [scopeSheet, setScopeSheet] = useState<"save" | "delete" | null>(null);
  const [scopePending, setScopePending] = useState<EventScope | null>(null);
  const [confirmFollowing, setConfirmFollowing] = useState(false);
  const [touched, setTouched] = useState(false);
  // 제목을 한 번이라도 고쳤는지. 빈 제목 오류는 고친 뒤 벗어나거나 저장을 눌렀을 때만 띄운다 (#80)
  const [titleEdited, setTitleEdited] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 처음 채운 값. 지금 값과 다르면 작성 중으로 보고 이탈 전에 묻는다 (#137)
  const [baseline, setBaseline] = useState<string | null>(() =>
    sourceId ? null : formSnapshot(draftTitle, draftAllDay, dateKeyOf(defaultStart), timeOf(defaultStart), dateKeyOf(defaultEnd), timeOf(defaultEnd), "", null, null, draftReminder, null),
  );

  // 성공 뒤 달력으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const create = useCreateEvent(groupId, { keepPendingAfterSuccess: true });
  const update = useUpdateEvent(groupId, { keepPendingAfterSuccess: true });
  const remove = useDeleteEvent(groupId, { keepPendingAfterSuccess: true });
  const saving = create.isPending || update.isPending;
  const deleting = remove.isPending;

  // 수정(또는 복제)이면 기존 일정을 받아 폼에 채운다
  const eventQ = useEvent(groupId, sourceId, occurrence);
  const loadedEvent = eventQ.data;
  useEffect(() => {
    if (!loadedEvent) return;
    const ev = loadedEvent;
    // 복제는 반복 안 함, 종료 없음으로 시작한다 (QA3-L2). 사용자가 반복 줄에서 다시 켤 수 있다
    const formRepeat = formRepeatOf(ev, !eventId);
    // 효과 본문에서 직접 setState 하지 않도록 마이크로태스크로 미룬다
    queueMicrotask(() => {
      setTitle(ev.title);
      setAllDay(ev.allDay);
      setStartDate(dateKeyOf(ev.startsAt));
      setStartTime(timeOf(ev.startsAt));
      if (ev.allDay) {
        setEndDate(addDays(dateKeyOf(ev.endsAt), -1));
        setEndTime("00:00");
      } else {
        setEndDate(dateKeyOf(ev.endsAt));
        setEndTime(timeOf(ev.endsAt));
      }
      setMemo(ev.memo ?? "");
      setRepeat(formRepeat.repeat);
      setUntilOn(Boolean(formRepeat.until));
      setUntilDate(formRepeat.until ?? "");
      // 수정은 그 회차의 값(예외 반영), 복제도 같은 값으로 시작한다 (#188)
      setReminder(reminderOf(ev.reminder));
      const evPick = pickOf(ev);
      setPick(evPick);
      if (eventId) setInitialPick(evPick);
      setBaseline(
        formSnapshot(
          ev.title,
          ev.allDay,
          dateKeyOf(ev.startsAt),
          timeOf(ev.startsAt),
          ev.allDay ? addDays(dateKeyOf(ev.endsAt), -1) : dateKeyOf(ev.endsAt),
          ev.allDay ? "00:00" : timeOf(ev.endsAt),
          ev.memo ?? "",
          formRepeat.repeat,
          formRepeat.until,
          reminderOf(ev.reminder),
          evPick,
        ),
      );
      if (eventId) setCreator(ev.creator);
      setLoaded(true);
    });
  }, [loadedEvent, eventId]);

  const loadError = eventQ.error;
  // 회차 주소가 404 면 원본이 아직 있는지 occurrence 없이 한 번 더 본다 (QA3-L7, lib/calendar-url missingEventTarget)
  const occurrenceMissing = loadError?.status === 404 && Boolean(occurrence);
  const seriesQ = useEvent(groupId, sourceId, null, { enabled: occurrenceMissing });
  const seriesSettled = !occurrenceMissing || seriesQ.data !== null || seriesQ.error !== null;
  const seriesAlive = seriesQ.data !== null;
  const goneHandled = useRef(false);
  useEffect(() => {
    if (!loadError) return;
    if (loadError.status === 404) {
      if (!seriesSettled || goneHandled.current) return;
      goneHandled.current = true;
      const target = missingEventTarget(groupId, occurrence, seriesAlive, todayKey());
      queueMicrotask(() => {
        toast.show(target.deleted ? "이미 삭제된 일정이에요" : "일정이 바뀌어서 그날 일정을 열었어요");
        router.replace(target.href);
      });
      return;
    }
    queueMicrotask(() => setSaveError(messageOf(loadError, "일정을 불러오지 못했어요. 새로고침해 주세요")));
  }, [loadError, seriesSettled, seriesAlive, occurrence, groupId, router, toast]);

  // 전송할 값 (종일이면 KST 자정 ~ 다음 날 자정)
  const payload = useMemo<EventInput | null>(() => {
    if (!startDate || !endDate) return null;
    const startsAt = allDay ? kstToIso(startDate) : kstToIso(startDate, startTime || "00:00");
    const endsAt = allDay ? kstToIso(addDays(endDate, 1)) : kstToIso(endDate, endTime || "00:00");
    // 수정에서 메모를 비우면 "" 를 보내 지운다 (생략하면 서버가 기존 메모를 유지한다)
    // 알림은 생성에서 "없음" 이면 생략, 수정은 API 가 아는 필드면 늘 싣는다 (lib/reminder reminderToSend). "이 일정만" 은 그 회차에, "이후 모두" 는 (새) 원본에 저장된다
    const sentReminder = reminderToSend(reminder, eventId ? (loadedEvent ?? null) : null);
    return {
      title: title.trim(),
      startsAt,
      endsAt,
      allDay,
      memo: memo.trim() || (eventId ? "" : undefined),
      ...(sentReminder === undefined ? {} : { reminder: sentReminder }),
    };
  }, [title, allDay, startDate, startTime, endDate, endTime, memo, eventId, reminder, loadedEvent]);

  // 수정 중인 일정이 반복 일정인지 (범위를 묻는다). 복제는 새 일정이라 해당 없음
  const series = eventId && loadedEvent?.repeat ? loadedEvent : null;
  // "이 일정만" 수정은 반복 줄을 숨긴다 (반복은 이후 모두에서만 바꾼다, 기획 3-4)
  const showRepeat = !(series && presetScope === "this");
  const until = repeat && untilOn && untilDate ? untilDate : null;
  // 반복 규칙을 바꿨는지. 바꿨으면 범위 시트에서 "이 일정만" 을 막는다
  const ruleChanged = Boolean(series) && (repeat !== series?.repeat || until !== series?.repeatUntil);

  const titleError = touched && title.trim().length === 0 ? "제목을 입력해 주세요" : null;
  const rangeError = (() => {
    if (!payload) return "날짜를 입력해 주세요";
    const s = Date.parse(payload.startsAt);
    const e = Date.parse(payload.endsAt);
    if (e <= s) return allDay ? "종료일은 시작일과 같거나 뒤여야 해요" : "종료는 시작보다 뒤여야 해요";
    if (e - s > 30 * DAY_MS) return "일정은 30일까지만 만들 수 있어요";
    return null;
  })();
  // "이후 모두" 에서 종료 날짜를 원본 그대로 두었으면 보내지 않는다 (서버가 이어받고 필요하면 늘린다, QA3-L1)
  const sentUntil = series ? followingUntil(until, series.repeatUntil) : until;
  // "이후 모두" 에서 시작, 종료를 불러온 값 그대로 두었으면 보내지 않는다. 서버가 그 회차의 규칙 자리에서 잇는다 (QA3-M3)
  const timesKept = Boolean(series && payload && keepsLoadedTimes(payload, series));
  // 반복 줄, 반복 시트의 설명 날짜. 규칙을 이어받으면 원본 기준 날짜("매월 31일"), 아니면 폼의 시작 날짜
  const ruleDateFor = (r: Repeat) => formRuleDate(series, r, startDate, timesKept);
  // 반복 규칙 (설계 4-1): 길이 < 주기, 종료 날짜 >= 첫 회차 날짜. 줄을 숨기면 보지 않는다. 보내지 않는 종료 날짜는 보지 않는다
  const repeatError =
    payload && showRepeat
      ? repeatRuleError(repeat, Date.parse(payload.startsAt), Date.parse(payload.endsAt), startDate, sentUntil === undefined ? null : sentUntil)
      : null;
  // 종일 전환에서 "없음" 으로 되돌리므로 정상 흐름에선 생기지 않는다. 서버와 같은 문장으로 막아 둔다
  const remindError = reminderError(reminder, allDay);
  // 참여자 줄 (#248, 7-3). "이 일정만" 으로 들어온 반복 수정과 개인 팀은 숨긴다
  const showParticipants = Boolean(group) && showParticipantRow({ personal, thisOnly: Boolean(series && presetScope === "this") });
  const memberIds = useMemo(() => (group?.members ?? []).flatMap((m) => (m.userId === null ? [] : [m.userId])), [group]);
  // 지금 값. 새 일정 기본은 [나], 복제는 원본 참여자를 지금 멤버로 거르고 비면 [나] (D-142)
  const currentPick: ParticipantPick | null =
    pick === null ? (meId !== null ? [meId] : null) : copyFrom && !eventId && meId !== null ? copyPick(pick, memberIds, meId) : pick;
  const pickChanged = participantsChanged({ editing, current: currentPick, initial: initialPick });
  const participantsShown = group && currentPick ? participantsFromPick(currentPick, group.members) : null;
  const canSave = Boolean(payload) && title.trim().length > 0 && !rangeError && !repeatError && !remindError && !saving && scopePending === null;

  // 저장, 삭제가 끝나 화면을 떠나는 중이면 확인하지 않는다
  const [done, setDone] = useState(false);
  const dirty =
    !done && loaded && baseline !== null && formSnapshot(title, allDay, startDate, startTime, endDate, endTime, memo, repeat, until, reminder, pick) !== baseline;
  const leave = useLeaveGuard(dirty);
  const untilLabelId = useId();
  const cancel = useCallback(() => leave.request(() => router.back()), [leave, router]);

  // 메모 칸은 내용만큼 늘어난다 (손잡이 대신, #140 L17)
  const memoRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = memoRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [memo, loaded]);

  // 종일을 켜면 종료일이 시작일보다 앞서지 않게 맞춘다
  function toggleAllDay(v: boolean) {
    setAllDay(v);
    setReminder((r) => reminderAfterAllDayChange(r, v));
    if (v && endDate < startDate) setEndDate(startDate);
    if (!v && endDate === startDate && endTime <= startTime) {
      const [h] = startTime.split(":").map(Number);
      setEndTime(`${String(Math.min(h + 1, 23)).padStart(2, "0")}:${startTime.split(":")[1]}`);
    }
  }

  function setEndFromIso(iso: string) {
    setEndDate(dateKeyOf(iso));
    setEndTime(timeOf(iso));
  }

  /** 시작을 옮기면 길이를 유지하게 종료도 같이 민다 (#67). 종일은 일 수, 시각 일정은 분 단위 길이 */
  function changeStart(nextDate: string, nextTime: string) {
    if (allDay) {
      const diff = startDate && endDate ? Math.max(0, Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS)) : 0;
      setStartDate(nextDate);
      setStartTime(nextTime);
      if (nextDate) setEndDate(addDays(nextDate, diff));
      return;
    }
    const oldS = Date.parse(kstToIso(startDate, startTime || "00:00"));
    const oldE = Date.parse(kstToIso(endDate, endTime || "00:00"));
    const len = oldE > oldS ? oldE - oldS : HOUR_MS;
    setStartDate(nextDate);
    setStartTime(nextTime);
    setEndFromIso(new Date(Date.parse(kstToIso(nextDate, nextTime)) + len).toISOString());
  }

  /** 종료가 시작보다 앞서면 자동으로 맞춘다 (#67).
   *  시각만 바꿨으면 다음 날 그 시각(밤샘 일정), 날짜를 바꿨으면 시작 1시간 뒤 */
  function changeEnd(nextDate: string, nextTime: string, by: "date" | "time") {
    if (allDay) {
      setEndDate(nextDate < startDate ? startDate : nextDate);
      return;
    }
    const s = Date.parse(kstToIso(startDate, startTime || "00:00"));
    const e = Date.parse(kstToIso(nextDate, nextTime || "00:00"));
    if (e > s) {
      setEndDate(nextDate);
      setEndTime(nextTime);
      return;
    }
    if (by === "time" && nextDate === startDate) {
      setEndDate(addDays(nextDate, 1));
      setEndTime(nextTime);
      return;
    }
    setEndFromIso(new Date(s + HOUR_MS).toISOString());
  }

  /** 반복을 바꾸려는 날짜까지로: 처음 켜면 시작 30일 뒤를 기본으로 */
  function chooseUntil(on: boolean) {
    setUntilOn(on);
    if (on && (!untilDate || untilDate < startDate)) setUntilDate(addDays(startDate, 30));
  }

  /** 보낼 본문. 반복 필드는 새 일정/한 번짜리 수정에서 켰을 때, 반복 일정은 "이후 모두" 일 때만 싣는다 (api.md 2.3) */
  function bodyFor(scope: EventScope | null): EventPatchInput | null {
    if (!payload) return null;
    // 참여자 (#248, D-142): 생성은 팀이면 늘, 수정은 바꿨을 때만. "이 일정만" 은 싣지 않는다 (서버 400)
    const sentParticipants = showParticipants
      ? participantsBody({ editing, personal, scope: series ? scope : null, current: currentPick, initial: initialPick })
      : undefined;
    const withParticipants = sentParticipants === undefined ? payload : { ...payload, participants: sentParticipants };
    if (series && scope === "following") {
      const { startsAt, endsAt, ...rest } = withParticipants;
      return {
        ...rest,
        ...(timesKept ? {} : { startsAt, endsAt }),
        repeat,
        ...(sentUntil === undefined ? {} : { repeatUntil: sentUntil }),
      };
    }
    if (series) return payload;
    return repeat ? { ...withParticipants, repeat, repeatUntil: until } : withParticipants;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSave || !payload) return;
    setSaveError(null);
    setParticipantError(null);
    // 반복 일정은 범위를 먼저 묻는다 (주소로 정해 왔으면 그 범위로 바로)
    if (series && !presetScope) {
      setScopeSheet("save");
      return;
    }
    await submit(series ? presetScope : null);
  }

  /** 범위 시트에서 고른 뒤. "이후 모두" 인데 뒤에 따로 바꾼 회차가 있으면 한 번 더 묻는다 (기획 3-4) */
  function pickScope(scope: EventScope) {
    if (scopeSheet === "delete") {
      void removeEvent(scope);
      return;
    }
    if (scope === "following" && series?.hasLaterExceptions) {
      setConfirmFollowing(true);
      return;
    }
    void submit(scope);
  }

  async function submit(scope: EventScope | null) {
    const input = bodyFor(scope);
    if (!input || !payload) return;
    setConfirmFollowing(false);
    setScopePending(scope);
    const target = series && scope ? { occurrence: series.occurrence ?? undefined, scope } : {};
    const r = eventId ? await update.mutate({ eventId, input, ...target }) : await create.mutate(input as EventInput);
    setScopePending(null);
    setScopeSheet(null);
    if (r.ok) {
      setDone(true);
      haptic("success");
      // 권한 안내 시트 계기 ① 일정 저장 성공 직후 (푸시 지원 앱에서 한 번만, 8-1). 시트는 루트에 있어 화면이 바뀌어도 남는다
      void maybeOpenPushPrompt();
      router.push(`/g/${groupId}/calendar?date=${dateKeyOf(payload.startsAt)}`);
      return;
    }
    if (r.error.status === 404) {
      toast.show("이미 삭제된 일정이에요");
      router.replace(`/g/${groupId}/calendar`);
      return;
    }
    // 참여자 검증 실패(멤버가 방금 나감 등)는 참여자 줄 아래에 (#248 7-3)
    const participantDetail = r.error.details?.find((d) => d.field === "participants");
    if (participantDetail) {
      setParticipantError(participantDetail.message || r.error.message);
      return;
    }
    setSaveError(messageOf(r.error, "저장하지 못했어요. 입력 내용은 그대로 있으니 다시 저장해 주세요"));
  }

  async function removeEvent(scope: EventScope | null = null) {
    if (!eventId) return;
    setScopePending(scope);
    const target = series && scope ? { occurrence: series.occurrence ?? undefined, scope } : {};
    const r = await remove.mutate({ eventId, ...target });
    setScopePending(null);
    setScopeSheet(null);
    if (r.ok) {
      setDone(true);
      toast.show("일정을 삭제했어요");
      router.replace(`/g/${groupId}/calendar?date=${startDate}`);
      return;
    }
    setConfirmDelete(false);
    setSaveError(messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
  }

  return (
    <form onSubmit={save} className="pt-1">
      <div className="flex h-10 items-center justify-between">
        <h1 className="t-title">{editing ? "일정 수정" : copyFrom ? "일정 복제" : "새 일정"}</h1>
        <button
          type="button"
          onClick={cancel}
          className="hit h-8 rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95"
        >
          취소
        </button>
      </div>

      {saveError && (
        <p role="alert" className="mt-2 rounded-xl bg-paper px-3.5 py-2.5 text-[14px] text-danger">
          {saveError}
        </p>
      )}

      {!loaded ? (
        <div className="mt-3 space-y-2" aria-busy="true" aria-label="불러오는 중">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {/* lg(≥1024): 왼쪽 제목, 날짜와 시각 | 오른쪽 알림, 반복, 메모. 저장 줄은 두 칸 아래 전체 폭 (#244) */}
          <div className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
            <div className="space-y-2">
              {/* 제목은 빠른 추가와 같은 44 상자 + 16/600 (#174 L3) */}
              <div className="rounded-xl bg-paper px-3.5 py-3">
                <label htmlFor="ev-title" className="sr-only">
                  제목
                </label>
                <input
                  id="ev-title"
                  className={titleInputClass}
                  placeholder="무슨 일정인가요?"
                  value={title}
                  onChange={(e) => {
                    setTitle(clampChars(e.target.value, TITLE_MAX));
                    setTitleEdited(true);
                  }}
                  // 자동 포커스된 빈 제목에서 그냥 벗어나는 것(모바일 키보드 닫기, 날짜 칸 탭)은 오류로 보지 않는다 (#80).
                  // 예전에는 blur 마다 touched 를 켜서 제목 아래 오류 줄(약 26px)이 끼어들며 아래 칸이 한 번에 밀렸다
                  onBlur={() => {
                    if (titleEdited) setTouched(true);
                  }}
                  autoFocus={!editing}
                  aria-invalid={Boolean(titleError)}
                  aria-describedby={titleError ? "ev-title-err" : undefined}
                />
                {titleError && (
                  <p id="ev-title-err" role="alert" className="mt-1.5 text-[12px] text-danger">
                    {titleError}
                  </p>
                )}
              </div>

              <div className="rounded-xl bg-paper px-3.5 py-2">
                <Toggle checked={allDay} onChange={toggleAllDay} label="종일" />
                <div className="mt-2 space-y-3 border-t border-line pb-1 pt-3">
                  {(
                    [
                      { key: "start", label: "시작", date: startDate, time: startTime },
                      { key: "end", label: "종료", date: endDate, time: endTime },
                    ] as const
                  ).map((row) => (
                    <div key={row.key}>
                      <span className="mb-1.5 block text-[12px] font-medium leading-4 text-ink-2">{row.label}</span>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <DatePicker
                            label={`${row.label} 날짜`}
                            value={row.date}
                            min={row.key === "end" ? startDate : undefined}
                            onChange={(v) => (row.key === "start" ? changeStart(v, startTime) : changeEnd(v, endTime, "date"))}
                          />
                        </div>
                        {!allDay && (
                          <div className="shrink-0 grow-0 basis-[148px]">
                            <TimePicker
                              label={`${row.label} 시각`}
                              value={row.time}
                              onChange={(v) => (row.key === "start" ? changeStart(startDate, v) : changeEnd(endDate, v, "time"))}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {rangeError && touched && (
                  <p role="alert" className="mb-1 mt-2 text-[12px] text-danger">
                    {rangeError}
                  </p>
                )}
                {rangeError && !touched && <p className="t-sub mb-1 mt-2">{rangeError}</p>}
              </div>

            </div>
            <div className="space-y-2">
              {/* 참여자 (#248, 7-3). 폰은 시각 블록 바로 아래, PC 2단이면 오른쪽 단 맨 위. 모양은 알림 줄과 같다 */}
              {showParticipants && participantsShown && (
                <div className="rounded-xl bg-paper px-3.5 py-1">
                  <button
                    type="button"
                    onClick={() => setParticipantOpen(true)}
                    aria-haspopup="dialog"
                    aria-describedby={participantError ? "ev-participants-err" : undefined}
                    className="flex min-h-11 w-full items-center gap-3 py-1 text-left"
                  >
                    <span className="shrink-0 text-[14px] font-semibold">참여자</span>
                    <ParticipantValue value={participantsShown} meId={meId} />
                    <IconChevronRight size={16} className="-mr-1 shrink-0 text-ink-2" />
                  </button>
                  {participantError && (
                    <p id="ev-participants-err" role="alert" className="mb-2 text-[13px] text-danger">
                      {participantError}
                    </p>
                  )}
                </div>
              )}

              {/* 알림 (#188, 8장). 종일 여부로 선택지가 갈린다. 웹, 1.0.x 앱은 아래 안내 한 줄 */}
              <div className="rounded-xl bg-paper px-3.5 py-1">
                <button
                  type="button"
                  onClick={() => setReminderOpen(true)}
                  aria-haspopup="dialog"
                  className="flex min-h-11 w-full items-center gap-3 py-1 text-left"
                >
                  <span className="shrink-0 text-[14px] font-semibold">알림</span>
                  <span className="ml-auto min-w-0 truncate text-[14px] text-ink-2">{REMINDER_LABEL[reminder]}</span>
                  <IconChevronRight size={16} className="-mr-1 shrink-0 text-ink-2" />
                </button>
                <ReminderNote className="-mt-1 pb-2" />
                {remindError && (
                  <p role="alert" className="mb-2 text-[12px] text-danger">
                    {remindError}
                  </p>
                )}
              </div>

              {showRepeat && (
                <div className="rounded-xl bg-paper px-3.5 py-1">
                  <button
                    type="button"
                    onClick={() => setRepeatOpen(true)}
                    aria-haspopup="dialog"
                    className="flex min-h-11 w-full items-center gap-3 py-1 text-left"
                  >
                    <span className="shrink-0 text-[14px] font-semibold">반복</span>
                    <span className="ml-auto min-w-0 truncate text-[14px] text-ink-2">{repeat ? repeatLabel(repeat, ruleDateFor(repeat)) : "반복 안 함"}</span>
                    <IconChevronRight size={16} className="-mr-1 shrink-0 text-ink-2" />
                  </button>
                  {repeat && (
                    <div role="group" aria-label="반복 종료" className="space-y-2 border-t border-line pb-2 pt-2">
                      <div className="flex min-h-9 items-center gap-3">
                        <span id={`${untilLabelId}`} className="shrink-0 text-[14px] font-semibold">
                          종료
                        </span>
                        <div className="ml-auto w-[176px]">
                          <Segmented
                            labelledBy={untilLabelId}
                            value={untilOn ? "date" : "forever"}
                            options={UNTIL_OPTIONS}
                            onChange={(v) => chooseUntil(v === "date")}
                          />
                        </div>
                      </div>
                      {untilOn && <DatePicker label="반복 종료 날짜" value={untilDate} min={startDate} onChange={setUntilDate} />}
                    </div>
                  )}
                  {repeatError && (
                    <p role="alert" className="mb-2 text-[12px] text-danger">
                      {repeatError}
                    </p>
                  )}
                </div>
              )}

              <div className="rounded-xl bg-paper px-3.5 py-3">
                <Field label="메모" hint={`${charCount(memo)}/${MEMO_MAX}`}>
                  {(id, describedBy) => (
                    <textarea
                      ref={memoRef}
                      id={id}
                      rows={4}
                      aria-describedby={describedBy}
                      className={`${inputClass} max-h-[50dvh] min-h-[96px] resize-none overflow-y-auto`}
                      placeholder="장소, 준비물, 링크 등"
                      value={memo}
                      onChange={(e) => setMemo(clampChars(e.target.value, MEMO_MAX))}
                    />
                  )}
                </Field>
              </div>

              {editing && creator && (
                <p className="flex items-center gap-1.5 px-1 pt-1 text-[12px] text-ink-2">
                  <MemberDot color={creator.color} size={8} />
                  {creator.displayName}님이 등록한 일정
                </p>
              )}

            </div>
          </div>
          {/* 폰은 독을 숨긴 자리에 저장 줄을 바닥에 붙인다 (#137) */}
          <div className="sticky bottom-0 z-10 -mx-5 flex gap-2 bg-surface px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2 fold:static fold:mx-0 fold:bg-transparent fold:px-0 fold:pb-0">
            <Button type="submit" size="lg" full disabled={!canSave} loading={saving} className="flex-1">
              {editing ? "저장" : "일정 추가"}
            </Button>
            {editing && (
              <Button type="button" variant="tile" size="lg" onClick={() => (series ? setScopeSheet("delete") : setConfirmDelete(true))} className="text-danger!">
                삭제
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={leave.pending}
        title="작성 중인 내용을 버릴까요?"
        body="지금 나가면 입력한 내용이 저장되지 않아요"
        confirmLabel="나가기"
        cancelLabel="계속 쓰기"
        danger
        onConfirm={leave.confirm}
        onCancel={leave.cancel}
      />
      <RepeatSheet
        open={repeatOpen}
        value={repeat}
        firstDate={startDate}
        labelDate={ruleDateFor}
        onPick={(v) => {
          setRepeat(v);
          setRepeatOpen(false);
        }}
        onClose={() => setRepeatOpen(false)}
      />
      {group && (
        <ParticipantSheet
          open={participantOpen}
          members={group.members}
          meId={meId}
          value={currentPick ?? []}
          onDone={(v) => {
            // 새 일정에서 기본값([나]) 그대로 고르면 작성 중으로 보지 않는다 (이탈 확인)
            setPick((prev) => (prev === null && meId !== null && samePick(v, [meId]) ? null : normalizePick(v)));
            setParticipantError(null);
            setParticipantOpen(false);
          }}
          onClose={() => setParticipantOpen(false)}
        />
      )}
      <ReminderSheet
        open={reminderOpen}
        allDay={allDay}
        value={reminder}
        onPick={(v) => {
          setReminder(v);
          setReminderOpen(false);
          // 권한 안내 시트 계기 ② "없음" 이 아닌 값을 처음 고를 때 (8-1)
          if (v !== "NONE") void maybeOpenPushPrompt();
        }}
        onClose={() => setReminderOpen(false)}
      />
      {series && (
        <ScopeSheet
          open={scopeSheet !== null}
          mode={scopeSheet ?? "save"}
          occurrence={series.occurrence ?? startDate}
          onlyFollowing={scopeSheet === "save" && (ruleChanged || pickChanged)}
          pending={scopePending}
          onPick={pickScope}
          onClose={() => setScopeSheet(null)}
        />
      )}
      <ConfirmDialog
        open={confirmFollowing}
        title="이후 모두 바꿀까요?"
        body="이후 따로 바꾼 회차도 새 값으로 바뀌어요"
        confirmLabel="바꾸기"
        neutral
        loading={scopePending === "following"}
        onConfirm={() => void submit("following")}
        onCancel={() => setConfirmFollowing(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="이 일정을 삭제할까요?"
        body="팀원 모두에게서 사라져요"
        confirmLabel="삭제"
        danger
        loading={deleting}
        onConfirm={() => void removeEvent()}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}

const UNTIL_OPTIONS: { value: "forever" | "date"; label: string }[] = [
  { value: "forever", label: "계속" },
  { value: "date", label: "날짜까지" },
];

/** 이탈 확인용 폼 값 요약. 같은 값이면 같은 문자열 */
function formSnapshot(
  title: string,
  allDay: boolean,
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
  memo: string,
  repeat: Repeat | null,
  until: string | null,
  reminder: EventReminder,
  participants: ParticipantPick | null,
): string {
  return JSON.stringify([
    title.trim(),
    allDay,
    startDate,
    allDay ? "" : startTime,
    endDate,
    allDay ? "" : endTime,
    memo.trim(),
    repeat,
    until,
    reminder,
    participants === null ? null : normalizePick(participants),
  ]);
}
