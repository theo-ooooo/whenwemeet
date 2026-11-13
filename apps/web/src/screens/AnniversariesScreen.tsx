"use client";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { useToast } from "@/components/Toast";
import { IconCalendar, IconChevronRight, IconHeart, IconPlus } from "@/components/icons";
import { NameField } from "@/components/NameField";
import { DatePicker } from "@/components/pickers";
import { ReminderChoicesRow } from "@/components/ReminderChoicesRow";
import { Button, EmptyState, ErrorState, MemberDot, RowGroup, Segmented, Sheet, SkeletonList } from "@/components/ui";
import { messageOf, useAnniversaries, useBirthdays, useCreateAnniversary, useDeleteAnniversary, useUpdateAnniversary } from "@/hooks";
import { KIND_OPTIONS, kindOf, listValue, sortByNext } from "@/lib/anniversary";
import { DEFAULT_REMINDERS, reminderHint, remindersOf, sameReminders } from "@/lib/anniversary-reminder";
import { formatBirthday, withBirthdays } from "@/lib/birthday";
import { formatDateKo, todayKey } from "@/lib/date";
import { ME_BIRTHDAY_PATH, TEAM_PATH } from "@/lib/routes";
import type { Anniversary, AnniversaryInput, AnniversaryKind, AnniversaryReminder } from "@/lib/types";

type Editing = { mode: "new" } | { mode: "edit"; item: Anniversary } | null;

export function AnniversariesScreen() {
  const { groupId, group } = useGroupContext();
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
  // (#305) 멤버 생일은 같은 목록에 섞되 고치지 않는다 (내 생일은 내 정보에서). 못 받으면 기념일만
  const birthdaysQ = useBirthdays(groupId);
  const birthdays = birthdaysQ.data;
  const merged = useMemo(() => withBirthdays(items, birthdays, groupId), [items, birthdays, groupId]);
  // 다음 항목 날짜순, 다음이 없는 것(지난 '그날만')은 맨 아래 (기획 4장)
  const sorted = useMemo(() => (merged ? sortByNext(merged, today) : null), [merged, today]);
  const myId = group?.me.userId ?? null;
  // (#305) 내 생일이 이 팀 목록에 없으면 한 줄 안내: 이 팀에서 껐으면 팀 설정, 아니면(아직 안 넣음) 내 정보
  const birthdayHint =
    birthdays === null || !group || birthdays.some((b) => b.member.userId === myId)
      ? null
      : group.me.showBirthday === false
        ? { text: "이 팀 달력에는 내 생일을 보이지 않게 해 두었어요", href: TEAM_PATH, action: "팀 설정" }
        : { text: "내 생일을 넣으면 팀 달력에 매년 보여요", href: ME_BIRTHDAY_PATH, action: "내 생일 넣기" };
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
          <p className="t-sub mt-0.5">날짜를 등록하면 100일, 1주년이 달력에 표시돼요. 멤버 생일은 자동으로 보여요</p>
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
              const liClass = `main-lg:rounded-xl main-lg:bg-paper main-lg:px-4 main-lg:py-2 ${i === 0 ? "" : "border-t border-line main-lg:border-t-0"}`;
              if (a.birthdayOf !== undefined) {
                return (
                  <li key={a.id} className={liClass}>
                    <BirthdayRow item={a} mine={a.birthdayOf === myId} value={row.value} tone={row.tone} />
                  </li>
                );
              }
              return (
                <li key={a.id} className={liClass}>
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
        {birthdayHint && sorted !== null && (
          <p className="t-sub mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
            <span>{birthdayHint.text}</span>
            <Link href={birthdayHint.href} className="hit font-bold text-acc-ink">
              {birthdayHint.action}
            </Link>
          </p>
        )}
      </div>

      {/* (#378) 이름 + 날짜 줄 카드, 종류 세그먼트 + 알림 줄 카드, 안내 한 줄, 맨 아래 추가/저장 */}
      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing?.mode === "edit" ? "기념일 수정" : "기념일 추가"} tone="bg">
        <form onSubmit={save} className="space-y-2 pb-1">
          <RowGroup>
            <NameField
              label="기념일 이름"
              value={name}
              onChange={setName}
              max={30}
              limitInput
              placeholder="예: 처음 만난 날, 결혼기념일"
              autoFocus
              autoComplete="off"
              error={formError}
            />
            <DatePicker look="row" rowLabel="날짜" rowIcon={<IconCalendar size={18} />} label="기념일 날짜" value={date} onChange={setDate} withYear />
          </RowGroup>
          {/* 종류 (기획 3-1): 칸 안 세그먼트 3개, 기본 함께한 날 세기. 알림 (#269): 당일 / 하루 전 / 일주일 전 여러 개, 모두 오전 9시 */}
          <RowGroup hint={reminderHint(kind, reminders) ?? KIND_OPTIONS.find((o) => o.value === kind)?.hint}>
            <div className="pb-3 pt-2.5">
              <span id={kindLabelId} className="mb-2 block text-[14px] font-semibold">
                종류
              </span>
              <Segmented labelledBy={kindLabelId} value={kind} options={KIND_OPTIONS} onChange={setKind} />
            </div>
            <ReminderChoicesRow label="알림" value={reminders} onChange={setReminders} />
          </RowGroup>
          <div className="space-y-2 pt-1">
            <Button type="submit" size="xl" full disabled={!valid} loading={saving}>
              {editing?.mode === "edit" ? "저장" : "추가"}
            </Button>
            {editing?.mode === "edit" && (
              <Button type="button" variant="ghost" size="lg" full onClick={() => remove(editing.item)} className="text-danger!">
                삭제
              </Button>
            )}
          </div>
        </form>
      </Sheet>
    </div>
  );
}

/**
 * (#305) 멤버 생일 한 줄. 기념일처럼 고치지 않는다: 내 생일은 내 정보로 가는 링크, 다른 사람 생일은 그냥 줄.
 * 날짜는 연도 없이 "매년 3월 5일"
 */
function BirthdayRow({ item, mine, value, tone }: { item: Anniversary; mine: boolean; value: string; tone: "today" | "ahead" | "past" }) {
  const date = formatBirthday(item.date.slice(5));
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[15px] font-semibold leading-5">{item.name}</b>
        <span className="flex items-center gap-1.5 text-[12px] leading-4 text-ink-2">
          <MemberDot color={item.creator.color} size={6} />
          {mine ? `매년 ${date}, 내 정보에서 바꿀 수 있어요` : `매년 ${date}`}
        </span>
      </span>
      <span className={`shrink-0 text-[15px] font-bold tabular-nums ${tone === "today" ? "text-acc-ink" : "text-ink"}`}>{value}</span>
      {mine && <IconChevronRight size={14} className="-mr-1 shrink-0 text-ink-2" />}
    </>
  );
  const cls = "flex min-h-11 w-full items-center gap-3 py-2 text-left main-lg:h-full";
  return mine ? (
    <Link href={ME_BIRTHDAY_PATH} className={cls} aria-label={`${item.name}, 매년 ${date}, ${value}. 내 정보에서 바꾸기`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
