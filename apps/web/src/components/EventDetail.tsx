"use client";
// 일정 상세. 날짜 상세(DayPanel) 안에서 일정 행이나 칩을 누르면 같은 표면이 이것으로 바뀐다 (폴더블.md 5-2)
// 내용: 제목, 시간, 반복, 알림, 참여자(#248), 메모, "○○님이 추가", 등록/수정 시각, 수정/복제/삭제. 제목줄 [공유](#274).
// 개인 팀은 사람 표시가 없던 그대로 등록자 한 줄만 둔다 (7-2)
import { useRouter } from "next/navigation";
import { useEventShareSheet } from "./EventShareSheet";
import { IconArrowRight, IconBell, IconChevronLeft, IconClose, IconShare } from "./icons";
import { ParticipantList, useWho } from "./Participants";
import { memberColor } from "@/lib/colors";
import { addDays, dateKeyOf, dowOf, parseKey, timeOf, todayKey, toKst, WEEKDAYS, type DateKey } from "@/lib/date";
import { isShareEnded } from "@/lib/event-share";
import { eventCopyHref, eventEditHref } from "@/lib/recurrence";
import { recurrenceLines } from "@/lib/recurrence-label";
import { reminderDetail } from "@/lib/reminder";
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
  const who = useWho();
  const startKey = dateKeyOf(ev.startsAt);
  const endKey = ev.allDay ? addDays(dateKeyOf(ev.endsAt), -1) : dateKeyOf(ev.endsAt);
  const edited = ev.updatedAt && ev.updatedAt !== ev.createdAt;
  // 반복 일정이면 시각 아래 "매주 목요일" + (종료가 있으면) "12월 31일까지" (기획 3-5)
  const rec = recurrenceLines(ev, todayKey());
  // 알림 (#188). 없음이면 줄을 두지 않는다
  const remind = reminderDetail(ev.reminder);
  // (#274) 공유: 개인 팀과 이미 끝난 회차는 숨긴다 (API 도 GROUP_NOT_INVITABLE, EVENT_SHARE_ENDED 로 막는다)
  const canShare = !who.personal && !isShareEnded(ev.endsAt);
  const share = useEventShareSheet(groupId, ev);

  return (
    <div>
      {/* 뒤로 화살표 선을 시트 여백 16 에 맞춘다(광학 정렬, 빠른 추가와 같음). 버튼 칸은 왼쪽으로 내밀고 누르는 영역 44 는 hit 가 유지 (#174 L9) */}
      <div data-drag className="flex h-10 touch-none items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          className="hit -ml-2 flex h-8 min-w-0 items-center gap-0.5 rounded-sm pl-0.5 pr-2 text-[13px] font-semibold text-ink-2 hover:bg-hover hover:text-ink"
        >
          <IconChevronLeft size={18} className="shrink-0" />
          <span className="truncate">{backLabel}</span>
          <span className="sr-only">로 돌아가기</span>
        </button>
        <span className="flex-1" />
        {canShare && (
          <button
            type="button"
            onClick={share.open}
            aria-label="일정 공유"
            className="hit grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
          >
            <IconShare size={18} />
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="닫기" className="hit grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink">
          <IconClose size={18} />
        </button>
      </div>
      {who.personal && (
        <span className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
          <i aria-hidden="true" className="block size-2 rounded-full" style={{ background: memberColor(ev.creator.color) }} />
          {iGa(ev.creator.displayName)} 등록
        </span>
      )}
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
      {rec && (
        <p className="mt-2 px-0.5 text-[13px] leading-[18px] text-soft">
          <span className="block font-semibold">{rec.rule}</span>
          {rec.until && <span className="block text-ink-2">{rec.until}</span>}
        </p>
      )}
      {remind && (
        <p className="mt-2 flex items-center gap-1.5 px-0.5 text-[13px] leading-[18px] text-soft">
          <IconBell size={16} className="shrink-0 text-ink-2" />
          {remind}
        </p>
      )}
      {!who.personal && <ParticipantList event={ev} meId={who.meId} />}
      {ev.memo && <p className="mt-2.5 whitespace-pre-wrap text-[14px] leading-5 text-soft">{ev.memo}</p>}
      {/* 참여자와 등록자는 다를 수 있다. 등록자는 여기 한 줄 (#248 D-140) */}
      {!who.personal && <p className="mt-2.5 text-[12px] leading-4 text-ink-2">{ev.creator.displayName}님이 추가</p>}
      <p className={`${who.personal ? "mt-2.5" : "mt-0.5"} text-[12px] leading-4 text-ink-2`}>
        {stamp(ev.createdAt)} 등록{edited ? ` · ${stamp(ev.updatedAt)} 수정` : ""}
      </p>
      {/* 세 버튼 같은 폭 (#167). 위계는 색으로: 수정 주 버튼, 복제 보조 면, 삭제 보조 면 + 위험 글자. 시트와 팝오버가 같다 */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => router.push(eventEditHref(groupId, ev))}
          className="h-11 rounded-md bg-btn text-[13.5px] font-bold text-on-btn hover:brightness-95"
        >
          수정
        </button>
        <button
          type="button"
          onClick={() => router.push(eventCopyHref(groupId, ev))}
          className="h-11 rounded-md bg-hover text-[13.5px] font-bold hover:brightness-95"
        >
          복제
        </button>
        <button type="button" onClick={onDelete} className="h-11 rounded-md bg-hover text-[13.5px] font-bold text-danger hover:brightness-95">
          삭제
        </button>
      </div>
      {canShare && share.sheet}
    </div>
  );
}
