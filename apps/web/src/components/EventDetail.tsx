"use client";
// 일정 상세. 날짜 상세(DayPanel) 안에서 일정 행이나 칩을 누르면 같은 표면이 이것으로 바뀐다 (폴더블.md 5-2)
// 내용: 제목, 시간, 반복, 알림, 참여자(#248), 메모, "○○님이 추가", 등록/수정 시각, 수정. 머리 ⋯ 메뉴에 공유(#274), 복제, 삭제.
// 개인 팀은 사람 표시가 없던 그대로 등록자 한 줄만 둔다 (7-2)
// (#190) 참여자 줄 아래 참석 여부(참여자만)와 반응 줄. 개인 팀은 둘 다 숨긴다
// (#199) 시간 정보 바로 아래 "장소"(작은 지도 + 길찾기)와 "메모" 칸. 메모는 이름 있는 칸, 읽기 좋은 글자, 링크. 없으면 칸이 없다
// (#378) 2026-11-13 "수정" 옆 "삭제" 를 잘못 눌러 일정이 지워졌다. 아래 버튼은 주 버튼 "수정" 하나만 두고
//   공유, 복제, 삭제는 머리 오른쪽 ⋯ 메뉴로 옮긴다. 삭제는 부르는 쪽(CalendarScreen)이 확인 창(반복이면 범위 시트)을 띄우고, 지운 뒤 되돌리기(#375).
//   칸 순서는 시간 → 장소 → 참여자, 참석 → 메모 → 반응 (나머지 화면 점검 1)
// (#536) ⋯ 메뉴 맨 아래 "신고하기"(남이 만든 일정만, 개인 달력 제외) → 신고 시트 (D-289)
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEventShareSheet } from "./EventShareSheet";
import { IconArrowRight, IconBell, IconChevronLeft, IconShare } from "./icons";
import { OverflowMenu, type OverflowMenuItem } from "./OverflowMenu";
import { ReportSheet, type ReportTarget } from "./ReportSheet";
import { CloseButton } from "./ui";
import { EventResponses } from "./EventResponses";
import { MemoSection } from "./MemoSection";
import { PlaceSection } from "./PlaceSection";
import { ParticipantList, useWho } from "./Participants";
import { memberColor } from "@/lib/colors";
import { addDays, clockRangeText, clockText, dateKeyOf, dowOf, parseKey, todayKey, toKst, WEEKDAYS, type DateKey } from "@/lib/date";
import { isShareEnded } from "@/lib/event-share";
import { eventCopyHref, eventEditHref } from "@/lib/routes";
import { eventKey } from "@/lib/recurrence";
import { recurrenceLines } from "@/lib/recurrence-label";
import { showRsvp } from "@/lib/rsvp";
import { reminderDetail } from "@/lib/reminder";
import { iGa } from "@/lib/text";
import type { Event } from "@/lib/types";

/** '11월 14일 오후 7:30' (시각 표기는 일정 줄과 같다, lib/date.ts clockText) */
function stamp(iso: string): string {
  const t = toKst(iso);
  return `${t.m}월 ${t.d}일 ${clockText(iso)}`;
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
  onResponded,
}: {
  event: Event;
  groupId: number;
  titleId: string;
  /** ← 옆 글자 (그날 "10일 화요일") */
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
  /** 삭제를 골랐을 때. 확인 창(반복이면 범위 시트)은 부르는 쪽이 띄운다 */
  onDelete: () => void;
  /** (#190) 참석 여부를 바꾸면 목록을 다시 받게 (다가오는 일정의 "응답" 표시) */
  onResponded?: () => void;
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
  // (#536) 남이 만든 일정만 신고 (탈퇴한 멤버의 일정 포함). 개인 달력은 내 일정뿐이라 없다
  const canReport = !who.personal && who.meId !== null && ev.creator.userId !== who.meId;
  const [report, setReport] = useState<ReportTarget | null>(null);
  const menu: OverflowMenuItem[] = [
    ...(canShare ? [{ label: "공유", onSelect: share.open }] : []),
    { label: "복제", onSelect: () => router.push(eventCopyHref(ev)) },
    { label: "삭제", destructive: true as const, confirm: "caller" as const, onSelect: onDelete },
    ...(canReport ? [{ label: "신고하기", onSelect: () => setReport({ targetType: "event" as const, targetId: ev.id }) }] : []),
  ];
  const memo = <MemoSection memo={ev.memo} />;
  const withRsvp = !who.personal && Boolean(ev.rsvp);

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
        <OverflowMenu label="일정 메뉴" items={menu} />
        <CloseButton onClick={onClose} className="shrink-0" />
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
      {/* 같은 날이면 날짜는 한 번, 시각은 일정 줄과 같은 '오전 10:30 ~ 12:00' (#174 L8, QA 2026-11-14 표기 통일).
          여러 날이면 시작, 끝 칸에 날짜를 각각 */}
      {startKey === endKey ? (
        <div className="mt-2 rounded-sm bg-surface px-3.5 py-2.5">
          <small className="block text-[12px] leading-4 text-ink-2">{short(startKey)}</small>
          <b className="block text-[15px] font-bold leading-5">{ev.allDay ? "종일" : clockRangeText(ev.startsAt, ev.endsAt)}</b>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-sm bg-surface px-3.5 py-2.5">
          <div>
            <small className="block text-[12px] leading-4 text-ink-2">{short(startKey)}</small>
            <b className="block text-[15px] font-bold leading-5">{ev.allDay ? "종일" : clockText(ev.startsAt)}</b>
          </div>
          <IconArrowRight size={16} className="text-ink-2" />
          <div className="text-right">
            <small className="block text-[12px] leading-4 text-ink-2">{short(endKey)}</small>
            <b className="block text-[15px] font-bold leading-5">{ev.allDay ? "종일" : clockText(ev.endsAt)}</b>
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
      <PlaceSection place={ev.place} />
      {!who.personal && <ParticipantList event={ev} meId={who.meId} />}
      {withRsvp ? (
        <EventResponses
          key={eventKey(ev)}
          event={ev}
          groupId={groupId}
          meId={who.meId}
          showRsvp={showRsvp(ev, who.personal)}
          onChanged={onResponded}
          between={memo}
        />
      ) : (
        memo
      )}
      {/* 참여자와 등록자는 다를 수 있다. 등록자는 여기 한 줄 (#248 D-140) */}
      {!who.personal && <p className="mt-2.5 text-[12px] leading-4 text-ink-2">{ev.creator.displayName}님이 추가</p>}
      <p className={`${who.personal ? "mt-2.5" : "mt-0.5"} text-[12px] leading-4 text-ink-2`}>
        {stamp(ev.createdAt)} 등록{edited ? ` · ${stamp(ev.updatedAt)} 수정` : ""}
      </p>
      {/* (#378) 아래는 주 버튼 "수정" 하나 + 옆에 작은 공유(시안 "수정 하나(+ 공유)"). 복제, 삭제는 ⋯ 메뉴 */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => router.push(eventEditHref(ev))}
          className="h-11 min-w-0 flex-1 rounded-md bg-btn text-[13.5px] font-bold text-on-btn hover:brightness-95"
        >
          수정
        </button>
        {canShare && (
          <button
            type="button"
            onClick={share.open}
            aria-label="일정 공유"
            className="grid h-11 w-12 shrink-0 place-items-center rounded-md bg-hover text-ink hover:brightness-95"
          >
            <IconShare size={20} />
          </button>
        )}
      </div>
      {canShare && share.sheet}
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </div>
  );
}
