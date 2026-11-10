"use client";
import { useId, useMemo, useState } from "react";
import { useToast } from "@/components/Toast";
import { IconPlus } from "@/components/icons";
import { DatePicker } from "@/components/pickers";
import { Button, ErrorState, Field, MemberDot, Sheet, SkeletonList, inputClass } from "@/components/ui";
import { messageOf, useAnniversaries, useCreateAnniversary, useDeleteAnniversary, useUpdateAnniversary } from "@/hooks";
import { KIND_OPTIONS, kindOf, mainLabel, nextOccurrence, sortByNext } from "@/lib/anniversary";
import { dayBadge } from "@/lib/day-detail";
import { formatDateKo, parseKey, todayKey } from "@/lib/date";
import type { Anniversary, AnniversaryKind } from "@/lib/types";

type Editing = { mode: "new" } | { mode: "edit"; item: Anniversary } | null;

export function AnniversariesScreen({ groupId }: { groupId: number }) {
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
    } else {
      setName("");
      setDate(today);
      setKind("COUNT_UP");
    }
  }

  const valid = name.trim().length >= 1 && name.trim().length <= 30 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !editing) return;
    setFormError(null);
    const input = { name: name.trim(), date, kind };
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
        const restored = await create.mutate({ name: item.name, date: item.date, kind: kindOf(item) });
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
      <div className="mt-2 flex items-center justify-between gap-3 lg:mt-0">
        <div>
          <h1 className="t-title">기념일</h1>
          <p className="t-sub mt-0.5">100일, 1주년, 생일이 달력에 자동으로 보여요</p>
        </div>
        <Button size="sm" onClick={() => open({ mode: "new" })}>
          <IconPlus size={14} strokeWidth={2.2} />
          기념일 추가
        </Button>
      </div>

      <div className="mt-3">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : sorted === null ? (
          <SkeletonList rows={2} />
        ) : sorted.length === 0 ? (
          <p className="rounded-xl bg-paper px-4 py-6 text-center text-[14px] leading-5 text-ink-2">
            기념일을 등록하면 100일, 1주년이 달력에 자동으로 보여요.
            <br />첫 기념일을 추가해 보세요
          </p>
        ) : (
          <ul className="rounded-xl bg-paper px-3.5 py-1">
            {sorted.map((a, i) => {
              // 대표 라벨 (기획 3-4) + 아래 "다음 {라벨} {M월 D일} D-n". '그날만' 이 지나면 다음 줄 없음
              const main = mainLabel(a, today);
              const next = nextOccurrence(a, today);
              const isToday = main === "D-day" || next?.date === today;
              // 매년, 그날만은 대표 라벨이 곧 다음 날이라 N일, N주년일 때만 (시작일 전 COUNT_UP 도 대표 라벨 D-n 이 같은 날)
              const np = next ? parseKey(next.date) : null;
              const hint = next?.label && np ? `다음 ${next.label} ${np.m}월 ${np.d}일 ${dayBadge(next.date, today)}` : null;
              return (
                <li key={a.id} className={i === 0 ? "" : "border-t border-line"}>
                  <button
                    type="button"
                    onClick={() => open({ mode: "edit", item: a })}
                    aria-haspopup="dialog"
                    className="flex min-h-11 w-full items-center gap-3 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[15px] font-semibold leading-5">{a.name}</b>
                      <span className="flex items-center gap-1.5 text-[12px] leading-4 text-ink-2">
                        {formatDateKo(a.date, true)}
                        <MemberDot className="ml-1" color={a.creator.color} size={6} />
                        {a.creator.displayName}
                      </span>
                      {hint && (
                        <span className={`block text-[12px] font-medium leading-4 ${next?.date === today ? "text-acc-ink" : "text-soft"}`}>{hint}</span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 text-[14px] font-bold tabular-nums ${isToday ? "text-acc-ink" : ""}`}
                    >
                      {main}
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
            <div role="radiogroup" aria-labelledby={kindLabelId} className="grid grid-cols-3 gap-1 rounded-sm bg-surface p-1">
              {KIND_OPTIONS.map((o) => {
                const on = kind === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setKind(o.value)}
                    className={`anim-pick flex h-9 items-center justify-center rounded-[8px] px-1 text-[13px] whitespace-nowrap ${on ? "bg-paper font-bold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "font-medium text-soft hover:text-ink"}`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="t-sub mt-1.5">{KIND_OPTIONS.find((o) => o.value === kind)?.hint}</p>
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
