"use client";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { CalendarKindRow } from "@/components/CalendarKindRow";
import { MonthDayPicker } from "@/components/pickers/MonthDayPicker";
import { useToast } from "@/components/Toast";
import { IconCake, IconCalendar, IconChevronRight, IconHeart, IconPlus } from "@/components/icons";
import { NameField } from "@/components/NameField";
import { DatePicker } from "@/components/pickers";
import { ReminderChoicesRow } from "@/components/ReminderChoicesRow";
import { Button, EmptyState, ErrorState, RowGroup, Segmented, Sheet, SkeletonList } from "@/components/ui";
import { messageOf, useAnniversaries, useBirthdays, useCreateAnniversary, useDeleteAnniversary, useUpdateAnniversary } from "@/hooks";
import { KIND_OPTIONS, kindOf, listValue, lunarYearHint, sortByNext } from "@/lib/anniversary";
import { DEFAULT_REMINDERS, reminderHint, remindersOf, sameReminders } from "@/lib/anniversary-reminder";
import { formatBirthday, withBirthdays } from "@/lib/birthday";
import { formatDateKo, keyOf, parseKey, todayKey, type DateKey } from "@/lib/date";
import { type CalendarKind, formatLunar, hasLeapMonth, isLunarDate, lunarOccurrence, lunarToSolar, solarToLunar } from "@/lib/lunar";
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
  // (#562) 양력/음력, 윤달. 음력이면 date 가 음력 연월일
  const [calendar, setCalendar] = useState<CalendarKind>("SOLAR");
  const [leap, setLeap] = useState(false);
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
      setCalendar(next.item.calendar ?? "SOLAR");
      setLeap(next.item.isLeapMonth ?? false);
    } else {
      setName("");
      setDate(today);
      setKind("COUNT_UP");
      setReminders([...DEFAULT_REMINDERS]);
      setCalendar("SOLAR");
      setLeap(false);
    }
  }

  // (#562) 양력 ↔ 음력을 바꾸면 같은 날을 가리키게 날짜를 옮긴다 (2026-02-17 ↔ 음력 2026-01-01)
  function changeCalendar(next: CalendarKind) {
    if (next === calendar) return;
    if (next === "LUNAR") {
      const l = solarToLunar(date);
      if (l) {
        setDate(keyOf(l.year, l.month, l.day));
        setLeap(l.leap);
      }
    } else {
      const { y, m, d } = parseKey(date);
      const solar = lunarToSolar({ year: y, month: m, day: d, leap }) ?? lunarOccurrence(y, m, d, leap);
      if (solar) setDate(solar);
      setLeap(false);
    }
    setCalendar(next);
  }

  // (#562) 음력 날짜 검사: 윤달을 골랐으면 그 해에 그 윤달이 있는지, 그 달에 그날(30일)이 있는지. 틀리면 저장을 막고 이유 한 줄
  const lunarParts = calendar === "LUNAR" ? parseKey(date) : null;
  const effectiveLeap = calendar === "LUNAR" && leap;
  const lunarError = !lunarParts
    ? null
    : effectiveLeap && !hasLeapMonth(lunarParts.y, lunarParts.m)
      ? `음력 ${lunarParts.y}년에는 윤${lunarParts.m}월이 없어요`
      : !isLunarDate({ year: lunarParts.y, month: lunarParts.m, day: lunarParts.d, leap: effectiveLeap })
        ? `음력 ${lunarParts.y}년 ${effectiveLeap ? "윤" : ""}${lunarParts.m}월은 29일까지예요`
        : null;
  const lunarHint = calendar === "LUNAR" && !lunarError ? lunarYearHint({ date, calendar, isLeapMonth: effectiveLeap, kind }, today) : null;

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

  const valid = name.trim().length >= 1 && name.trim().length <= 30 && /^\d{4}-\d{2}-\d{2}$/.test(date) && !lunarError;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !editing) return;
    setFormError(null);
    // 알림은 기본값과 다를 때(추가), 바뀌었을 때(수정)만 싣는다. 앱 셸이 옛 API 를 볼 때도 다른 칸 저장이 막히지 않게
    const input: AnniversaryInput = { name: name.trim(), date, kind };
    // (#562) 달력 종류는 음력이거나 음력에서 양력으로 바꿀 때만 싣는다 (양력 그대로면 지금 본문 그대로)
    if (calendar === "LUNAR" || (editing.mode === "edit" && editing.item.calendar === "LUNAR")) {
      input.calendar = calendar;
      input.isLeapMonth = calendar === "LUNAR" && effectiveLeap;
    }
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
      setItems((prev) => (prev ?? []).map((a) => (a.id === saved.id ? saved : a)));
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
          ...(item.calendar === "LUNAR" ? { calendar: "LUNAR" as const, isLeapMonth: item.isLeapMonth ?? false } : {}),
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
                  <button type="button" onClick={() => open({ mode: "edit", item: a })} aria-haspopup="dialog" className={rowClass}>
                    <DdayCell value={row.value} tone={row.tone} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <b className="truncate text-[15px] font-semibold leading-5">{a.name}</b>
                        {a.calendar === "LUNAR" && <LunarMark />}
                      </span>
                      <span className="block truncate text-[12px] leading-4 text-ink-2">{anniversaryDateText(a)}</span>
                      {row.sub && <span className="block truncate text-[12px] leading-4 text-ink-2">{row.sub}</span>}
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
            {calendar === "LUNAR" && lunarParts ? (
              <MonthDayPicker
                label="날짜"
                icon={<IconCalendar size={18} />}
                lunar
                withYear
                leap={effectiveLeap}
                value={{ y: lunarParts.y, m: lunarParts.m, d: lunarParts.d }}
                onChange={(v) => setDate(keyOf(v.y ?? lunarParts.y, v.m, v.d))}
              />
            ) : (
              <DatePicker look="row" rowLabel="날짜" rowIcon={<IconCalendar size={18} />} label="기념일 날짜" value={date} onChange={setDate} withYear />
            )}
            {/* (#562) 양력/음력 세그먼트 + 음력이면 윤달 체크 */}
            <CalendarKindRow calendar={calendar} onCalendar={changeCalendar} leap={effectiveLeap} onLeap={setLeap} />
          </RowGroup>
          {(lunarError || lunarHint) && (
            <p role={lunarError ? "alert" : undefined} className={`t-sub px-1 ${lunarError ? "text-danger!" : ""}`}>
              {lunarError ?? lunarHint}
            </p>
          )}
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

/** (#378) 줄 모양: 왼쪽 D-day 칸 + 이름과 날짜. D-day 가 오른쪽 끝에 떨어져 있어 줄과 이어지지 않던 것을 앞으로 (나머지 화면 점검 7) */
const rowClass = "flex min-h-11 w-full items-center gap-3 py-2 text-left main-lg:h-full";

/** 왼쪽 D-day 칸 (15/700). 오늘은 코랄 글자, 지난 '그날만' 은 흐리게 */
function DdayCell({ value, tone }: { value: string; tone: "today" | "ahead" | "past" }) {
  return (
    <span
      className={`w-14 shrink-0 text-[15px] font-bold leading-5 tabular-nums tracking-[-0.01em] ${tone === "today" ? "text-acc-ink" : tone === "past" ? "text-ink-2" : "text-ink"}`}
    >
      {value}
    </span>
  );
}

/**
 * (#305) 멤버 생일 한 줄. 기념일처럼 고치지 않는다: 내 생일은 내 정보로 가는 링크, 다른 사람 생일은 그냥 줄.
 * 날짜는 연도 없이 "매년 3월 5일". (#378) 이름 옆 작은 케이크 선 아이콘으로 기념일과 구분하고, 넣은 사람 점은 뺐다
 */
function BirthdayRow({ item, mine, value, tone }: { item: Anniversary; mine: boolean; value: string; tone: "today" | "ahead" | "past" }) {
  const date = formatBirthday(item.date.slice(5), item.calendar, item.isLeapMonth);
  const body = (
    <>
      <DdayCell value={value} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <b className="truncate text-[15px] font-semibold leading-5">{item.name}</b>
          <IconCake size={15} className="shrink-0 text-ink-2" />
          {item.calendar === "LUNAR" && <LunarMark />}
        </span>
        <span className="block truncate text-[12px] leading-4 text-ink-2">{mine ? `매년 ${date}, 내 정보에서 바꿀 수 있어요` : `매년 ${date}`}</span>
      </span>
      {mine && <IconChevronRight size={14} className="-mr-1 shrink-0 text-ink-2" />}
    </>
  );
  return mine ? (
    <Link href={ME_BIRTHDAY_PATH} className={rowClass} aria-label={`${item.name}, 매년 ${date}, ${value}. 내 정보에서 바꾸기`}>
      {body}
    </Link>
  ) : (
    <div className={rowClass}>{body}</div>
  );
}

/** (#562) 음력 기념일, 생일의 작은 "음력" 표시 (이름 옆, 보조 글자색 테두리 알약) */
function LunarMark() {
  return <span className="shrink-0 rounded-[5px] border border-line px-1 text-[10px] font-semibold leading-[15px] text-ink-2">음력</span>;
}

/** 목록 둘째 줄 날짜: 양력 "2024년 3월 15일 (금)", (#562) 음력은 이름 옆 "음력" 표시가 있어 "1996년 11월 8일" (윤달 "윤4월") */
function anniversaryDateText(a: Anniversary): string {
  if (a.calendar !== "LUNAR") return formatDateKo(a.date as DateKey, true);
  const { y, m, d } = parseKey(a.date);
  return formatLunar(m, d, a.isLeapMonth ?? false, y).replace(/^음력 /, "");
}
