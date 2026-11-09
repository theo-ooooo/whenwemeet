"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { Button, ErrorState, Field, MemberDot, Sheet, SkeletonList, inputClass } from "@/components/ui";
import { messageOf, useAnniversaries, useCreateAnniversary, useDeleteAnniversary, useUpdateAnniversary } from "@/hooks";
import { dday, formatDateKo, hundredHint, todayKey } from "@/lib/date";
import type { Anniversary } from "@/lib/types";

type Editing = { mode: "new" } | { mode: "edit"; item: Anniversary } | null;

export function AnniversariesScreen({ groupId }: { groupId: string }) {
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
  const saving = create.isPending || update.isPending;
  const [formError, setFormError] = useState<string | null>(null);

  function open(next: Editing) {
    setEditing(next);
    setFormError(null);
    if (next?.mode === "edit") {
      setName(next.item.name);
      setDate(next.item.date);
    } else {
      setName("");
      setDate(today);
    }
  }

  const valid = name.trim().length >= 1 && name.trim().length <= 30 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !editing) return;
    setFormError(null);
    const input = { name: name.trim(), date };
    const r = editing.mode === "new" ? await create.mutate(input) : await update.mutate({ id: editing.item.id, input });
    if (!r.ok) {
      setFormError(messageOf(r.error, "저장하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    const saved = r.data;
    if (editing.mode === "new") {
      setItems((prev) => [...(prev ?? []), saved].sort((a, b) => a.date.localeCompare(b.date)));
    } else {
      setItems((prev) =>
        (prev ?? []).map((a) => (a.id === saved.id ? saved : a)).sort((a, b) => a.date.localeCompare(b.date)),
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
      setItems((prev) => [...(prev ?? []), item].sort((a, b) => a.date.localeCompare(b.date)));
      toast.show(messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    toast.show(`'${item.name}' 을 삭제했어요`, {
      actionLabel: "되돌리기",
      onAction: async () => {
        const restored = await create.mutate({ name: item.name, date: item.date });
        if (!restored.ok) {
          toast.show(messageOf(restored.error, "되돌리지 못했어요. 다시 추가해 주세요"));
          return;
        }
        setItems((prev) => [...(prev ?? []), restored.data].sort((a, b) => a.date.localeCompare(b.date)));
      },
    });
  }

  return (
    <div className="pt-1">
      <div className="mt-2 flex items-center justify-between">
        <div>
          <h1 className="t-title">기념일</h1>
          <p className="t-sub mt-1">가장 가까운 날이 달력 위에 보여요</p>
        </div>
        <Button size="sm" onClick={() => open({ mode: "new" })}>
          + 기념일 추가
        </Button>
      </div>

      <div className="mt-5">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items === null ? (
          <SkeletonList rows={2} />
        ) : items.length === 0 ? (
          <p className="rounded-lg bg-paper px-5 py-8 text-center text-[14px] leading-relaxed text-ink-2">
            기념일을 등록하면 달력 위에 D-day 가 보여요.
            <br />첫 기념일을 추가해 보세요
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((a) => {
              const d = dday(a.date, today);
              const hint = hundredHint(d.diff);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => open({ mode: "edit", item: a })}
                    className="flex w-full items-center gap-4 rounded-lg bg-paper px-4 py-3.5 text-left hover:bg-brand-soft/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{a.name}</span>
                      <span className="t-sub mt-0.5 flex items-center gap-1.5">
                        {formatDateKo(a.date, true)}
                        <MemberDot className="ml-1" color={a.creator.color} size={6} />
                        {a.creator.displayName}
                      </span>
                      {hint && <span className="mt-1 block text-[12px] font-semibold text-brand">{hint}</span>}
                    </span>
                    <span
                      className={`shrink-0 rounded-sm px-2.5 py-1 text-[15px] font-bold tabular-nums ${
                        d.diff === 0 ? "bg-brand text-paper" : d.diff < 0 ? "bg-brand-soft text-brand" : "bg-surface text-ink"
                      }`}
                    >
                      {d.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing?.mode === "edit" ? "기념일 수정" : "기념일 추가"}>
        <form onSubmit={save} className="space-y-4">
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
              <input id={id} type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
            )}
          </Field>
          <Button type="submit" size="lg" full disabled={!valid} loading={saving}>
            {editing?.mode === "edit" ? "저장" : "추가"}
          </Button>
          {editing?.mode === "edit" && (
            <Button type="button" variant="danger" size="md" full onClick={() => remove(editing.item)}>
              삭제
            </Button>
          )}
        </form>
      </Sheet>
    </div>
  );
}
