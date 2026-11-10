"use client";
// 일정 상세. 날짜 상세(DayPanel) 안에서 일정 행이나 칩을 누르면 같은 표면이 이것으로 바뀐다 (폴더블.md 5-2)
// 내용은 기존 상세와 같다: 등록자, 제목, 시간, 메모, 등록/수정 시각, 수정/복제/삭제
import { useRouter } from "next/navigation";
import { IconArrowRight, IconChevronLeft, IconClose } from "./icons";
import { memberColor } from "@/lib/colors";
import { addDays, dateKeyOf, dowOf, parseKey, timeOf, toKst, WEEKDAYS, type DateKey } from "@/lib/date";
import { iGa } from "@/lib/text";
import type { Event } from "@/lib/types";

/** 'M월 D일 HH:mm' */
function stamp(iso: string): string {
  const t = toKst(iso);
  return `${t.m}월 ${t.d}일 ${String(t.h).padStart(2, "0")}:${String(t.min).padStart(2, "0")}`;
}

const short = (k: DateKey) => {
  const p = parseKey(k);
  return `${p.m}월 ${p.d}일 (${WEEKDAYS[dowOf(k)]})`;
};

export function EventDetail({
  event: ev,
  groupId,
  titleId,
  backLabel,
  onBack,
  onClose,
  onDelete,
}: {
  event: Event;
  groupId: number;
  titleId: string;
  /** ← 옆 글자 (그날 "10일 화요일") */
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const startKey = dateKeyOf(ev.startsAt);
  const endKey = ev.allDay ? addDays(dateKeyOf(ev.endsAt), -1) : dateKeyOf(ev.endsAt);
  const edited = ev.updatedAt && ev.updatedAt !== ev.createdAt;

  return (
    <div>
      {/* 뒤로 버튼 왼쪽 끝을 시트 여백 16 에 맞추고, 화살표는 빠른 추가의 아이콘 칸 32 가운데와 같은 자리(왼쪽 7) (#174 L9) */}
      <div data-drag className="flex h-10 touch-none items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          className="hit flex h-8 min-w-0 items-center gap-0.5 rounded-sm pl-[7px] pr-2 text-[13px] font-semibold text-ink-2 hover:bg-hover hover:text-ink"
        >
          <IconChevronLeft size={18} className="shrink-0" />
          <span className="truncate">{backLabel}</span>
          <span className="sr-only">로 돌아가기</span>
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onClose} aria-label="닫기" className="hit grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink">
          <IconClose size={18} />
        </button>
      </div>
      <span className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
        <i aria-hidden="true" className="block size-2 rounded-full" style={{ background: memberColor(ev.creator.color) }} />
        {iGa(ev.creator.displayName)} 등록
      </span>
      <h2 id={titleId} tabIndex={-1} data-autofocus className="mt-1 text-[20px] font-bold leading-7 tracking-[-0.02em] break-words outline-none">
        {ev.title}
      </h2>
      {/* 같은 날이면 날짜는 한 번, 시각은 '10:30 → 12:00' (#174 L8). 여러 날이면 시작, 끝 칸에 날짜를 각각 */}
      {startKey === endKey ? (
        <div className="mt-2 rounded-sm bg-surface px-3.5 py-2.5">
          <small className="block text-[12px] leading-4 text-ink-2">{short(startKey)}</small>
          <b className="flex items-center gap-1.5 text-[15px] font-bold leading-5">
            {ev.allDay ? (
              "종일"
            ) : (
              <>
                {timeOf(ev.startsAt)}
                <IconArrowRight size={14} className="text-ink-2" />
                <span className="sr-only">부터</span>
                {timeOf(ev.endsAt)}
              </>
            )}
          </b>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-sm bg-surface px-3.5 py-2.5">
          <div>
            <small className="block text-[12px] leading-4 text-ink-2">{short(startKey)}</small>
            <b className="block text-[15px] font-bold leading-5">{ev.allDay ? "종일" : timeOf(ev.startsAt)}</b>
          </div>
          <IconArrowRight size={16} className="text-ink-2" />
          <div className="text-right">
            <small className="block text-[12px] leading-4 text-ink-2">{short(endKey)}</small>
            <b className="block text-[15px] font-bold leading-5">{ev.allDay ? "종일" : timeOf(ev.endsAt)}</b>
          </div>
        </div>
      )}
      {ev.memo && <p className="mt-2.5 whitespace-pre-wrap text-[14px] leading-5 text-soft">{ev.memo}</p>}
      <p className="mt-2.5 text-[12px] leading-4 text-ink-2">
        {stamp(ev.createdAt)} 등록{edited ? ` · ${stamp(ev.updatedAt)} 수정` : ""}
      </p>
      {/* 세 버튼 같은 폭 (#167). 위계는 색으로: 수정 주 버튼, 복제 보조 면, 삭제 보조 면 + 위험 글자. 시트와 팝오버가 같다 */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => router.push(`/g/${groupId}/events/${ev.id}`)}
          className="h-11 rounded-md bg-btn text-[13.5px] font-bold text-on-btn hover:brightness-95"
        >
          수정
        </button>
        <button
          type="button"
          onClick={() => router.push(`/g/${groupId}/events/new?copy=${ev.id}`)}
          className="h-11 rounded-md bg-hover text-[13.5px] font-bold hover:brightness-95"
        >
          복제
        </button>
        <button type="button" onClick={onDelete} className="h-11 rounded-md bg-hover text-[13.5px] font-bold text-danger hover:brightness-95">
          삭제
        </button>
      </div>
    </div>
  );
}
