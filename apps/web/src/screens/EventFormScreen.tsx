"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/Toast";
import { Button, ConfirmDialog, Field, MemberDot, Skeleton, Toggle, inputClass } from "@/components/ui";
import { messageOf, useCreateEvent, useDeleteEvent, useEvent, useUpdateEvent } from "@/hooks";
import { addDays, dateKeyOf, kstToIso, timeOf, todayKey } from "@/lib/date";
import type { Event, EventInput } from "@/lib/types";

type Props = {
  groupId: string;
  eventId?: string;
  initialStart?: string | null;
  initialEnd?: string | null;
};

const DAY_MS = 86_400_000;

export function EventFormScreen({ groupId, eventId, initialStart, initialEnd }: Props) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(eventId);

  const defaultStart = initialStart ?? kstToIso(todayKey(), "10:00");
  const defaultEnd = initialEnd ?? kstToIso(todayKey(), "11:00");

  const [loaded, setLoaded] = useState(!editing);
  const [creator, setCreator] = useState<Event["creator"] | null>(null);
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(dateKeyOf(defaultStart));
  const [startTime, setStartTime] = useState(timeOf(defaultStart));
  const [endDate, setEndDate] = useState(dateKeyOf(defaultEnd));
  const [endTime, setEndTime] = useState(timeOf(defaultEnd));
  const [memo, setMemo] = useState("");
  const [touched, setTouched] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 성공 뒤 달력으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const create = useCreateEvent(groupId, { keepPendingAfterSuccess: true });
  const update = useUpdateEvent(groupId, { keepPendingAfterSuccess: true });
  const remove = useDeleteEvent(groupId, { keepPendingAfterSuccess: true });
  const saving = create.isPending || update.isPending;
  const deleting = remove.isPending;

  // 수정이면 기존 일정을 받아 폼에 채운다
  const eventQ = useEvent(groupId, eventId);
  const loadedEvent = eventQ.data;
  useEffect(() => {
    if (!loadedEvent) return;
    const ev = loadedEvent;
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
      setCreator(ev.creator);
      setLoaded(true);
    });
  }, [loadedEvent]);

  const loadError = eventQ.error;
  useEffect(() => {
    if (!loadError) return;
    queueMicrotask(() => {
      if (loadError.status === 404) {
        toast.show("이미 삭제된 일정이에요");
        router.replace(`/g/${groupId}/calendar`);
        return;
      }
      setSaveError(messageOf(loadError, "일정을 불러오지 못했어요. 새로고침해 주세요"));
    });
  }, [loadError, groupId, router, toast]);

  // 전송할 값 (종일이면 KST 자정 ~ 다음 날 자정)
  const payload = useMemo<EventInput | null>(() => {
    if (!startDate || !endDate) return null;
    const startsAt = allDay ? kstToIso(startDate) : kstToIso(startDate, startTime || "00:00");
    const endsAt = allDay ? kstToIso(addDays(endDate, 1)) : kstToIso(endDate, endTime || "00:00");
    return { title: title.trim(), startsAt, endsAt, allDay, memo: memo.trim() || undefined };
  }, [title, allDay, startDate, startTime, endDate, endTime, memo]);

  const titleError = touched && title.trim().length === 0 ? "제목을 입력해 주세요" : null;
  const rangeError = (() => {
    if (!payload) return "날짜를 입력해 주세요";
    const s = Date.parse(payload.startsAt);
    const e = Date.parse(payload.endsAt);
    if (e <= s) return allDay ? "종료일은 시작일과 같거나 뒤여야 해요" : "종료는 시작보다 뒤여야 해요";
    if (e - s > 30 * DAY_MS) return "일정은 30일까지만 만들 수 있어요";
    return null;
  })();
  const canSave = Boolean(payload) && title.trim().length > 0 && !rangeError && !saving;

  // 종일을 켜면 종료일이 시작일보다 앞서지 않게 맞춘다
  function toggleAllDay(v: boolean) {
    setAllDay(v);
    if (v && endDate < startDate) setEndDate(startDate);
    if (!v && endDate === startDate && endTime <= startTime) {
      const [h] = startTime.split(":").map(Number);
      setEndTime(`${String(Math.min(h + 1, 23)).padStart(2, "0")}:${startTime.split(":")[1]}`);
    }
  }

  function changeStartDate(v: string) {
    const diff = startDate && endDate ? Math.max(0, Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS)) : 0;
    setStartDate(v);
    if (v) setEndDate(addDays(v, diff));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSave || !payload) return;
    setSaveError(null);
    const r = eventId ? await update.mutate({ eventId, input: payload }) : await create.mutate(payload);
    if (r.ok) {
      router.push(`/g/${groupId}/calendar?date=${dateKeyOf(payload.startsAt)}`);
      return;
    }
    if (r.error.status === 404) {
      toast.show("이미 삭제된 일정이에요");
      router.replace(`/g/${groupId}/calendar`);
      return;
    }
    setSaveError(messageOf(r.error, "저장하지 못했어요. 입력 내용은 그대로 있으니 다시 저장해 주세요"));
  }

  async function removeEvent() {
    if (!eventId) return;
    const r = await remove.mutate(eventId);
    if (r.ok) {
      toast.show("일정을 삭제했어요");
      router.replace(`/g/${groupId}/calendar?date=${startDate}`);
      return;
    }
    setConfirmDelete(false);
    setSaveError(messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
  }

  return (
    <form onSubmit={save} className="pt-1">
      <div className="flex h-11 items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          className="-ml-2 rounded-sm px-2 py-1 text-[14px] text-ink-2 hover:bg-paper"
        >
          취소
        </button>
        <h1 className="text-[16px] font-bold">{editing ? "일정 수정" : "새 일정"}</h1>
        <span className="w-10" aria-hidden="true" />
      </div>

      {saveError && (
        <p role="alert" className="mt-3 rounded-sm bg-paper px-4 py-3 text-[14px] text-danger">
          {saveError}
        </p>
      )}

      {!loaded ? (
        <div className="mt-4 space-y-4" aria-busy="true" aria-label="불러오는 중">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          <div className="rounded-lg bg-paper px-4 py-4">
            <label htmlFor="ev-title" className="sr-only">
              제목
            </label>
            <input
              id="ev-title"
              className="w-full bg-transparent text-[22px] font-bold tracking-[-0.02em] placeholder:font-semibold placeholder:text-ink-2/60 focus:outline-none"
              placeholder="무슨 일정인가요?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
              maxLength={50}
              autoFocus={!editing}
              aria-invalid={Boolean(titleError)}
              aria-describedby={titleError ? "ev-title-err" : undefined}
            />
            {titleError && (
              <p id="ev-title-err" role="alert" className="mt-1.5 text-[13px] text-danger">
                {titleError}
              </p>
            )}
          </div>

          <div className="rounded-lg bg-paper px-4 py-3">
            <Toggle checked={allDay} onChange={toggleAllDay} label="종일" />
            <div className="mt-3 space-y-4 border-t border-line pt-4">
              {(
                [
                  { key: "start", label: "시작", date: startDate, time: startTime },
                  { key: "end", label: "종료", date: endDate, time: endTime },
                ] as const
              ).map((row) => (
                <div key={row.key}>
                  <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{row.label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      aria-label={`${row.label} 날짜`}
                      className={`${inputClass} min-w-0 flex-1 px-3`}
                      value={row.date}
                      min={row.key === "end" ? startDate : undefined}
                      onChange={(e) => (row.key === "start" ? changeStartDate(e.target.value) : setEndDate(e.target.value))}
                      required
                    />
                    {!allDay && (
                      <input
                        type="time"
                        aria-label={`${row.label} 시각`}
                        className={`${inputClass} shrink-0 grow-0 basis-[136px] px-3`}
                        value={row.time}
                        step={300}
                        onChange={(e) => (row.key === "start" ? setStartTime(e.target.value) : setEndTime(e.target.value))}
                        required
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {rangeError && touched && (
              <p role="alert" className="mt-3 text-[13px] text-danger">
                {rangeError}
              </p>
            )}
            {rangeError && !touched && <p className="t-sub mt-3">{rangeError}</p>}
          </div>

          <div className="rounded-lg bg-paper px-4 py-4">
            <Field label="메모" hint={`${memo.length}/500`}>
              {(id, describedBy) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  className={`${inputClass} min-h-[96px] resize-y`}
                  placeholder="장소, 준비물, 링크 등"
                  value={memo}
                  maxLength={500}
                  onChange={(e) => setMemo(e.target.value)}
                />
              )}
            </Field>
          </div>

          {editing && creator && (
            <p className="flex items-center gap-1.5 px-1 text-[13px] text-ink-2">
              <MemberDot color={creator.color} size={8} />
              {creator.displayName}님이 등록한 일정
            </p>
          )}

          <div className="space-y-3 pt-2">
            <Button type="submit" size="lg" full disabled={!canSave} loading={saving}>
              {editing ? "저장" : "일정 추가"}
            </Button>
            {editing && (
              <Button type="button" variant="danger" size="lg" full onClick={() => setConfirmDelete(true)}>
                삭제
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="이 일정을 삭제할까요?"
        body="팀원 모두에게서 사라져요"
        confirmLabel="삭제"
        danger
        loading={deleting}
        onConfirm={removeEvent}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}
