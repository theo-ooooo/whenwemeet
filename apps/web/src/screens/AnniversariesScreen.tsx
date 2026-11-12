"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { IconHeart, IconPlus } from "@/components/icons";
import { DatePicker } from "@/components/pickers";
import { ReminderNote } from "@/components/ReminderPicker";
import { Button, EmptyState, ErrorState, Field, MemberDot, Segmented, Sheet, SkeletonList, ToggleChips, inputClass } from "@/components/ui";
import { messageOf, useAnniversaries, useCreateAnniversary, useDeleteAnniversary, useUpdateAnniversary } from "@/hooks";
import { KIND_OPTIONS, kindOf, listValue, sortByNext } from "@/lib/anniversary";
import {
  DEFAULT_REMINDERS,
  REMINDER_CHOICES,
  isChoiceOn,
  reminderHint,
  remindersOf,
  sameReminders,
  toggleReminder,
} from "@/lib/anniversary-reminder";
import { formatDateKo, todayKey } from "@/lib/date";
import type { Anniversary, AnniversaryInput, AnniversaryKind, AnniversaryReminder } from "@/lib/types";

type Editing = { mode: "new" } | { mode: "edit"; item: Anniversary } | null;

export function AnniversariesScreen() {
  const { groupId } = useGroupContext();
  const toast = useToast();
  const today = todayKey();
  const listQ = useAnniversaries(groupId);
  const items = listQ.data;
  const setItems = listQ.setData;
  const error = listQ.error ? messageOf(listQ.error, "기념일을 불러오지 못했어요") : null;
  const load = listQ.refetch;
  const create = useCreateAnniversary(groupId);
  const update = useUpdateAnniversary(groupId);
  const del = useDeleteAnniversary(groupId);
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<AnniversaryKind>("COUNT_UP");
  const kindLabelId = useId();
  // (#269) 알림 시점. 기념일에 하나, 팀 공통 (기획 푸시-알림.md 3-7)
  const [reminders, setReminders] = useState<AnniversaryReminder[]>([...DEFAULT_REMINDERS]);
  const reminderLabelId = useId();
  // 다음 항목 날짜순, 다음이 없는 것(지난 '그날만')은 맨 아래 (기획 4장)
  const sorted = useMemo(() => (items ? sortByNext(items, today) : null), [items, today]);
  const saving = create.isPending || update.isPending;
  const [formError, setFormError] = useState<string | null>(null);

  function open(next: Editing) {
    setEditing(next);
    setFormError(null);
    if (next?.mode === "edit") {
      setName(next.item.name);
      setDate(next.item.date);
      setKind(kindOf(next.item));
      setReminders(remindersOf(next.item));
    } else {
      setName("");
      setDate(today);
      setKind("COUNT_UP");
      setReminders([...DEFAULT_REMINDERS]);
    }
  }

  // + 는 하나만 (#170): 폰 + 가 이 화면에서는 기념일 추가 시트를 연다. 제목 옆 버튼은 + 가 없는 넓은 화면(≥600, 사이드바)에만 (#212)
  const { setFabAction } = useGroupContext();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    setFabAction({ label: "기념일 추가", run: () => openRef.current({ mode: "new" }) });
    return () => setFabAction(null);
  }, [setFabAction]);

  const valid = name.trim().length >= 1 && name.trim().length <= 30 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !editing) return;
    setFormError(null);
    // 알림은 기본값과 다를 때(추가), 바뀌었을 때(수정)만 싣는다. 앱 셸이 옛 API 를 볼 때도 다른 칸 저장이 막히지 않게
    const input: AnniversaryInput = { name: name.trim(), date, kind };
    const before = editing.mode === "new" ? DEFAULT_REMINDERS : remindersOf(editing.item);
    if (!sameReminders(reminders, before)) input.reminders = reminders;
    const r = editing.mode === "new" ? await create.mutate(input) : await update.mutate({ id: editing.item.id, input });
    if (!r.ok) {
      setFormError(messageOf(r.error, "저장하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    const saved = r.data;
    if (editing.mode === "new") {
      setItems((prev) => [...(prev ?? []), saved]);
    } else {
      setItems((prev) =>
        (prev ?? []).map((a) => (a.id === saved.id ? saved : a)),
      );
    }
    setEditing(null);
  }

  // 확인 없이 삭제 + 5초 되돌리기 (같은 값으로 다시 POST)
  async function remove(item: Anniversary) {
    setEditing(null);
    setItems((prev) => (prev ?? []).filter((a) => a.id !== item.id));
    const r = await del.mutate(item.id);
    if (!r.ok) {
      setItems((prev) => [...(prev ?? []), item]);
      toast.show(messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    toast.show(`'${item.name}' 을 삭제했어요`, {
      actionLabel: "되돌리기",
      onAction: async () => {
        const kept = remindersOf(item);
        const restored = await create.mutate({
          name: item.name,
          date: item.date,
          kind: kindOf(item),
          ...(sameReminders(kept, DEFAULT_REMINDERS) ? {} : { reminders: kept }),
        });
        if (!restored.ok) {
          toast.show(messageOf(restored.error, "되돌리지 못했어요. 다시 추가해 주세요"));
          return;
        }
        setItems((prev) => [...(prev ?? []), restored.data]);
      },
    });
  }

  return (
    <div className="pt-1">
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <div>
          <h1 className="t-title">기념일</h1>
          <p className="t-sub mt-0.5">날짜를 등록하면 100일, 1주년, 매년 생일이 달력에 표시돼요</p>
        </div>
        <span className="hidden shrink-0 fold:block">
          <Button size="sm" onClick={() => open({ mode: "new" })}>
            <IconPlus size={14} strokeWidth={2.2} />
            기념일 추가
          </Button>
        </span>
      </div>

      <div className="mt-3">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : sorted === null ? (
          <SkeletonList rows={2} />
        ) : sorted.length === 0 ? (
          <EmptyState icon={<IconHeart size={20} />} title="아직 기념일이 없어요">
            첫 기념일을 추가하면 100일, 1주년이 달력에 자동으로 보여요
          </EmptyState>
        ) : (
          // 본문 폭 main-lg(≥696, #323): 한 장 목록 대신 기념일마다 카드 하나, 2열(main-2xl 3열) 격자 (#244, 디자인규칙.md 2-2)
          <ul className="rounded-xl bg-paper px-3.5 py-1 main-lg:grid main-lg:grid-cols-2 main-lg:gap-3 main-lg:bg-transparent main-lg:p-0 main-2xl:grid-cols-3">
            {sorted.map((a, i) => {
              // 오른쪽 값은 모두 '다음 날까지' (D-n, 오늘), 누적 일수와 다음 라벨은 보조 줄 (#173)
              const row = listValue(a, today);
              return (
                <li key={a.id} className={`main-lg:rounded-xl main-lg:bg-paper main-lg:px-4 main-lg:py-2 ${i === 0 ? "" : "border-t border-line main-lg:border-t-0"}`}>
                  <button
                    type="button"
                    onClick={() => open({ mode: "edit", item: a })}
                    aria-haspopup="dialog"
                    className="flex min-h-11 w-full items-center gap-3 py-2 text-left main-lg:h-full"
                  >
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[15px] font-semibold leading-5">{a.name}</b>
                      <span className="flex items-center gap-1.5 text-[12px] leading-4 text-ink-2">
                        {formatDateKo(a.date, true)}
                        <MemberDot className="ml-1" color={a.creator.color} size={6} />
                        {a.creator.displayName}
                      </span>
                      {row.sub && <span className="block text-[12px] font-normal leading-4 text-ink-2">{row.sub}</span>}
                    </span>
                    <span
                      className={`shrink-0 text-[15px] font-bold tabular-nums ${row.tone === "today" ? "text-acc-ink" : row.tone === "past" ? "text-ink-2" : "text-ink"}`}
                    >
                      {row.value}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing?.mode === "edit" ? "기념일 수정" : "기념일 추가"}>
        <form onSubmit={save} className="space-y-3">
          <Field label="이름" hint={`${name.trim().length}/30`} error={formError}>
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={inputClass}
                value={name}
                maxLength={30}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 처음 만난 날, 결혼기념일"
                autoFocus
              />
            )}
          </Field>
          <Field label="날짜">
            {(id) => (
              <DatePicker id={id} label="기념일 날짜" value={date} onChange={setDate} withYear />
            )}
          </Field>
          {/* 종류 (기획 3-1): 세그먼트 3개, 기본 함께한 날 세기 */}
          <div>
            <span id={kindLabelId} className="mb-1.5 block text-[12px] font-medium leading-4 text-ink-2">
              종류
            </span>
            <Segmented labelledBy={kindLabelId} value={kind} options={KIND_OPTIONS} onChange={setKind} />
            <p className="t-sub mt-1.5">{KIND_OPTIONS.find((o) => o.value === kind)?.hint}</p>
          </div>
          {/* 알림 (#269, 기획 푸시-알림.md 3-7): 당일 / 하루 전 / 일주일 전 여러 개, "없음" 은 셋을 끈다. 모두 오전 9시 */}
          <div>
            <span id={reminderLabelId} className="mb-1.5 block text-[12px] font-medium leading-4 text-ink-2">
              알림 <span className="font-normal">(오전 9시)</span>
            </span>
            <ToggleChips
              labelledBy={reminderLabelId}
              options={REMINDER_CHOICES}
              isOn={(v) => isChoiceOn(reminders, v)}
              onToggle={(v) => setReminders((prev) => toggleReminder(prev, v))}
            />
            {reminderHint(kind, reminders) && <p className="t-sub mt-1.5">{reminderHint(kind, reminders)}</p>}
            <ReminderNote className="mt-1.5" />
          </div>
          <Button type="submit" size="lg" full disabled={!valid} loading={saving}>
            {editing?.mode === "edit" ? "저장" : "추가"}
          </Button>
          {editing?.mode === "edit" && (
            <Button type="button" variant="danger" size="lg" full onClick={() => remove(editing.item)}>
              삭제
            </Button>
          )}
        </form>
      </Sheet>
    </div>
  );
}
