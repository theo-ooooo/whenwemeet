"use client";
// 달력에서 바로 일정 추가 (#46).
// 모바일: 선택된 날짜를 한 번 더 누르면 바텀 시트. PC: 날짜 칸 빈 곳을 누르면 그 칸 옆 팝오버.
// 필드는 둘 다 같다 (제목, 종일, 시작/종료 시각). 저장은 useCreateEvent, "자세히" 는 새 일정 폼으로 값을 넘긴다.
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IconClose } from "./icons";
import { TimeList, TimePicker } from "./pickers";
import { minutesOf, timeOfMinutes } from "./pickers/time";
import { Button, Toggle, inputClass } from "./ui";
import { messageOf, useCreateEvent } from "@/hooks";
import { clampChars } from "@/lib/chars";
import { addDays, formatDateKo, kstToIso, type DateKey } from "@/lib/date";
import type { Event } from "@/lib/types";

type GroupId = Event["groupId"];

type CommonProps = {
  groupId: GroupId;
  date: DateKey;
  onClose: () => void;
  /** 저장 성공. 화면은 목록을 다시 받아 바로 보여준다 */
  onSaved: (ev: Event) => void;
};

/** 창 안 포커스 가능한 요소 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 열려 있는 동안 Tab 을 창 안에 가두고 Esc 로 닫는다. 닫히면 열기 전 포커스로 돌려준다 */
function useDialogKeys(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  // 렌더 시점에 잡아야 한다. 효과가 돌 때는 이미 제목 입력(autoFocus)으로 포커스가 옮겨가 있다
  const [prev] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 안쪽(펼친 시각 목록 등)이 Esc 를 먼저 처리했으면 창은 닫지 않는다
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // 닫은 뒤 원래 자리(날짜 칸, 추가 버튼)로 포커스를 돌린다
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [ref, onClose, prev]);
}

/* ---------- 폼 (시트, 팝오버 공통) ---------- */

function QuickAddForm({ groupId, date, onClose, onSaved, titleId, compact = false }: CommonProps & { titleId: string; compact?: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [timeOpen, setTimeOpen] = useState<"start" | "end" | null>(null);
  // 펼친 시각 목록을 닫으면 포커스를 그 시각 버튼으로 돌린다
  function closeTime() {
    if (timeOpen) document.getElementById(`${ids}-${timeOpen}`)?.focus({ preventScroll: true });
    setTimeOpen(null);
  }
  const [touched, setTouched] = useState(false);
  const create = useCreateEvent(groupId);

  const titleError = touched && title.trim().length === 0 ? "제목을 입력해 주세요" : null;
  const rangeError = !allDay && (!start || !end || (minutesOf(end) ?? 0) <= (minutesOf(start) ?? 0)) ? "종료는 시작보다 뒤여야 해요" : null;
  const saveError = create.error ? messageOf(create.error, "저장하지 못했어요. 다시 저장해 주세요") : null;

  const startsAt = allDay ? kstToIso(date) : kstToIso(date, start || "00:00");
  const endsAt = allDay ? kstToIso(addDays(date, 1)) : kstToIso(date, end || "00:00");

  function changeStart(v: string) {
    // 시작을 바꾸면 길이(기본 1시간)를 유지하게 종료를 같이 민다. 하루 안에서만 잡으므로 자정(24:00) 에서 멈춘다
    const s0 = minutesOf(start);
    const e0 = minutesOf(end);
    const len = s0 !== null && e0 !== null && e0 > s0 ? e0 - s0 : 60;
    setStart(v);
    const s = minutesOf(v);
    if (s === null) return;
    setEnd(timeOfMinutes(Math.min(s + len, 24 * 60)));
  }

  function changeEnd(v: string) {
    // 종료가 시작보다 앞서면 시작 1시간 뒤(자정까지) 로 맞춘다 (#67)
    const s = minutesOf(start);
    const e = minutesOf(v);
    if (s !== null && e !== null && e <= s) {
      setEnd(timeOfMinutes(Math.min(s + 60, 24 * 60)));
      return;
    }
    setEnd(v);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (title.trim().length === 0 || rangeError || create.isPending) return;
    const r = await create.mutate({ title: title.trim(), startsAt, endsAt, allDay });
    if (r.ok) onSaved(r.data);
  }

  function more() {
    // 종일이어도 시각은 그대로 넘긴다. 폼에서 종일을 끄면 그 시각이 보인다
    const q = new URLSearchParams({ start: kstToIso(date, start || "10:00"), end: kstToIso(date, end || "11:00") });
    if (title.trim()) q.set("title", title.trim());
    if (allDay) q.set("allDay", "1");
    router.push(`/g/${groupId}/events/new?${q.toString()}`);
  }

  return (
    <form onSubmit={save} noValidate>
      <div className="flex items-start justify-between gap-3">
        <div>
          <small className="block text-[12px] font-semibold text-ink-2">새 일정</small>
          <h2 id={titleId} className={`font-extrabold tracking-[-0.04em] ${compact ? "text-[20px]" : "text-[22px]"}`}>
            {formatDateKo(date)}
          </h2>
        </div>
        <button type="button" onClick={onClose} aria-label="빠른 추가 닫기" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface hover:brightness-95">
          <IconClose size={18} />
        </button>
      </div>

      <label htmlFor={`${ids}-title`} className="sr-only">
        제목
      </label>
      <input
        id={`${ids}-title`}
        autoFocus
        className={`${inputClass} mt-4 h-[52px] text-[16px]`}
        placeholder="무슨 일정인가요?"
        value={title}
        onChange={(e) => setTitle(clampChars(e.target.value, 50))}
        aria-invalid={Boolean(titleError)}
        aria-describedby={titleError ? `${ids}-title-err` : undefined}
        enterKeyHint="done"
      />
      {titleError && (
        <p id={`${ids}-title-err`} role="alert" className="mt-1.5 text-[13px] text-danger">
          {titleError}
        </p>
      )}

      <div className="mt-3">
        <Toggle checked={allDay} onChange={setAllDay} label="종일" />
        {!allDay && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
            <div>
              <span className="mb-1.5 block text-[12px] font-semibold text-ink-2">
                시작
              </span>
              <TimePicker
                id={`${ids}-start`}
                label="시작 시각"
                value={start}
                onChange={changeStart}
                to={23 * 60 + 30}
                inlineOpen={timeOpen === "start"}
                onInlineToggle={() => setTimeOpen((o) => (o === "start" ? null : "start"))}
              />
            </div>
            <div>
              <span className="mb-1.5 block text-[12px] font-semibold text-ink-2">종료</span>
              <TimePicker
                id={`${ids}-end`}
                label="종료 시각"
                value={end}
                onChange={changeEnd}
                allow24
                inlineOpen={timeOpen === "end"}
                onInlineToggle={() => setTimeOpen((o) => (o === "end" ? null : "end"))}
                aria-invalid={Boolean(rangeError)}
                aria-describedby={rangeError ? `${ids}-range-err` : undefined}
              />
            </div>
          </div>
        )}
        {!allDay && timeOpen && (
          <div className="mt-2 rounded-md border border-line p-2">
            <TimeList
              key={timeOpen}
              value={timeOpen === "start" ? start : end}
              to={timeOpen === "start" ? 23 * 60 + 30 : undefined}
              allow24={timeOpen === "end"}
              listClassName="max-h-[200px]"
              onPick={(v) => {
                if (timeOpen === "start") changeStart(v);
                else changeEnd(v);
                closeTime();
              }}
              onClose={closeTime}
            />
          </div>
        )}
      </div>
      {rangeError && (
        <p id={`${ids}-range-err`} role="alert" className="mt-1.5 text-[13px] text-danger">
          {rangeError}
        </p>
      )}
      {saveError && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {saveError}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="button" variant="secondary" size="lg" onClick={more} className="shrink-0 px-5">
          자세히
        </Button>
        <Button type="submit" size="lg" full loading={create.isPending}>
          저장
        </Button>
      </div>
    </form>
  );
}

/* ---------- 모바일 바텀 시트 ---------- */

export function QuickAddSheet(props: CommonProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogKeys(panel, props.onClose);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button type="button" aria-label="닫기" tabIndex={-1} onClick={props.onClose} className="anim-fade absolute inset-0 bg-black/35" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="anim-sheet relative max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl bg-paper px-[22px] pb-[calc(26px+env(safe-area-inset-bottom))] pt-3"
      >
        <div aria-hidden="true" className="mx-auto mb-[14px] h-[5px] w-10 rounded-full bg-[var(--grab)]" />
        <QuickAddForm {...props} titleId={titleId} />
      </div>
    </div>
  );
}

/* ---------- PC 팝오버 ---------- */

const POP_W = 340;
const GAP = 10;
const MARGIN = 16;

/** 날짜 칸 옆(오른쪽, 자리가 없으면 왼쪽)에 붙인다. 위아래는 화면 안으로 맞춘다 */
function placeBeside(anchor: DOMRect, h: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right + GAP;
  if (left + POP_W > vw - MARGIN) left = anchor.left - GAP - POP_W;
  left = Math.max(MARGIN, Math.min(left, vw - MARGIN - POP_W));
  const top = Math.max(MARGIN, Math.min(anchor.top, vh - MARGIN - h));
  return { left, top };
}

export function QuickAddPopover({ anchor, ...props }: CommonProps & { anchor: HTMLElement | null }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const { onClose } = props;
  useDialogKeys(panel, onClose);

  // 처음 그린 뒤 높이를 재서 자리를 잡는다. 창 크기가 바뀌면 다시
  useLayoutEffect(() => {
    const place = () => {
      if (!panel.current) return;
      const rect = anchor?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2 - POP_W / 2, 120, 0, 0);
      setPos(placeBeside(rect, panel.current.offsetHeight));
    };
    place();
    const ro = new ResizeObserver(place);
    if (panel.current) ro.observe(panel.current);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  // 바깥을 누르면 닫는다. 다른 칸을 누르면 닫힌 뒤 그 칸의 클릭으로 새로 열린다
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, width: POP_W, boxShadow: "var(--pop-shadow)" }}
      // 자리 잡기 전에는 투명하게만 둔다. visibility:hidden 이면 제목 입력의 autoFocus 가 먹지 않는다
      className={`fixed z-40 rounded-xl border border-line bg-paper p-5 ${pos ? "anim-fade" : "opacity-0"}`}
    >
      <QuickAddForm {...props} titleId={titleId} compact />
    </div>
  );
}
