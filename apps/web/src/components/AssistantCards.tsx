"use client";
// (#450) AI 비서 카드 (설계 AI-비서.md 7-6, 7-7, 승인 시안). 볼까 말풍선 아래 전체 폭 카드.
//   eventDraft  4px 색 막대 + 제목 17/700 + 날짜 시각 + 장소(핀) + 참여자 아바타와 이름 / [고치기] [추가]
//   freeSlots   조건 한 줄 + 줄(날짜 600, 시각 코랄 700, "이 시간으로 일정") + [이 N개로 투표 열기]
//   pollDraft   제목 + 후보 줄 + 대상 아바타 / [고치기](PollCreateSheet) [투표 열기]
//   eventList   공통 일정 줄(EventRow) 최대 10개 + "외 N개" + 기념일, 생일 줄
//   clarify     이름 알약(누르면 그 이름을 보낸다), unsupported 링크 알약. refusal 은 말풍선만
//   (#511) eventEditDraft   바꾸기 전 → 후 (바뀐 칸만 전 값을 지운 줄로) / [고치기](수정 화면) [수정]
//          eventDeleteDraft 지울 일정 / [취소] [삭제] (되돌리기 7초 토스트)
//          eventChoice      후보 줄(최대 5개). 누르면 그 후보의 확인 카드를 웹이 만든다 (서버 요청 없음)
// 저장은 기존 훅(useCreateEvent, useCreatePoll, (#511) useUpdateEvent, useDeleteEvent)으로만 하고 X-Client-Source 를 싣는다 (6-1). 같은 카드의 저장은 한 번만.
// (#511) 반복 일정은 그 회차만(scope this) 고치고 지운다. "이후 모두" 는 [고치기] 로 연 수정 화면에서 (D-283)
import Link from "next/link";
import { useState } from "react";
import { useGroupContext } from "./AppShell";
import { useAssistant } from "./AssistantProvider";
import { EventList, EventRow } from "./EventRow";
import { IconCheck, IconChevronRight, IconClock, IconHeart, IconPin } from "./icons";
import { PollCreateSheet } from "./PollCreateSheet";
import { useToast } from "./Toast";
import { Avatar, Button } from "./ui";
import { useEventDeleteToast } from "./useEventDeleteToast";
import { messageOf, useCreateEvent, useCreatePoll, useDeleteEvent, useUpdateEvent } from "@/hooks";
import {
  canPollFrom,
  cardOfChoice,
  editChanges,
  eventPatchOf,
  targetScope,
  ddayText,
  draftLunarText,
  draftWhenText,
  eventEditHref,
  eventInputOf,
  freeQueryText,
  pollDraftFromSlots,
  pollInputOf,
  pollSheetMinutes,
  rowEventOf,
  slotEditHref,
  slotTimeText,
  type AssistantCard,
  type EventTarget,
  type ShowDate,
} from "@/lib/assistant";
import { memberColor } from "@/lib/colors";
import { dateKeyOf, formatDateKo, todayKey } from "@/lib/date";
import { MUTE } from "@/lib/participants";
import { calendarHref, eventEditHref as eventEditPageHref, pollHref } from "@/lib/routes";
import { hasBatchim } from "@/lib/text";
import type { Event, Member } from "@/lib/types";

/** 카드 면. 폰 화면은 바탕(--bg) 위 타일, 넓은 화면 패널은 타일(--tile) 위라 바탕색 면 */
export type CardTone = "paper" | "surface";
const toneClass = (t: CardTone) => (t === "paper" ? "bg-paper" : "bg-surface");
/** 카드 안 보조 버튼 면. 타일 카드 위는 --hover, 바탕색 카드(패널) 위는 타일 + 1px 선 (--hover 가 바탕과 같은 색이라, #166) */
const subtleClass = (t: CardTone) => (t === "paper" ? "bg-hover" : "border border-line bg-paper");
/** 카드 밖 알약(이름 고르기, 링크). 대화 바탕 위라 카드와 같은 면 */
const pillClass = (t: CardTone) => (t === "paper" ? "bg-paper" : "bg-surface");

type CardProps = {
  /** 결과 키 `${메시지 id}:${카드 순번}` */
  resultKey: string;
  tone: CardTone;
  /** 넓은 화면 패널: [추가] 뒤 달력이 그날을 보이게, "달력에서 보기" 는 이동 대신 그 일정 상세를 연다 (#470) */
  onShowDate?: ShowDate;
};

export function AssistantCardView({ card, ...rest }: CardProps & { card: AssistantCard }) {
  switch (card.type) {
    case "eventDraft":
      return <EventDraftCardView card={card} {...rest} />;
    case "eventEditDraft":
      return <EventEditDraftCardView card={card} {...rest} />;
    case "eventDeleteDraft":
      return <EventDeleteDraftCardView card={card} {...rest} />;
    case "eventChoice":
      return <EventChoiceCardView card={card} {...rest} />;
    case "freeSlots":
      return <FreeSlotsCardView card={card} {...rest} />;
    case "pollDraft":
      return <PollDraftCardView card={card} {...rest} />;
    case "eventList":
      return <EventListCardView card={card} {...rest} />;
    case "clarify":
      return <ClarifyView card={card} tone={rest.tone} />;
    case "unsupported":
      return card.link ? (
        <Link
          href={card.link.href}
          className={`inline-flex h-11 items-center gap-1 rounded-full px-4 text-[14px] font-bold text-ink hover:bg-hover ${pillClass(rest.tone)}`}
        >
          {card.link.label}
          <IconChevronRight size={16} />
        </Link>
      ) : null;
    case "refusal":
      return null;
  }
}

/** 참여자 아바타 20 + 이름 (색만으로 구분하지 않는다) */
function MemberLine({ members, meId }: { members: readonly Member[]; meId: number | null }) {
  if (members.length === 0) return null;
  const names = members.map((m) => (meId !== null && m.userId === meId ? "나" : m.displayName)).join(", ");
  return (
    <p className="mt-2 flex min-w-0 items-center gap-2 text-[13px] leading-5 text-ink-2">
      <span aria-hidden="true" className="flex shrink-0 -space-x-1">
        {members.slice(0, 4).map((m) => (
          <span key={m.userId ?? m.displayName} className="rounded-full ring-2 ring-[var(--tile)]">
            <Avatar member={m} color={m.color} size={20} />
          </span>
        ))}
      </span>
      <span className="min-w-0 truncate">{names}</span>
    </p>
  );
}

/** 저장 뒤 버튼 자리: ✓ + 문구 + 링크 */
function DoneLine({ text, link }: { text: string; link: React.ReactNode }) {
  return (
    <p className="mt-3 flex min-h-11 flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] font-semibold leading-5 text-ink">
      <IconCheck size={18} className="shrink-0 text-acc-ink" />
      <span>{text}</span>
      {link}
    </p>
  );
}

const linkCls = "font-bold text-acc-ink underline underline-offset-2";

function EventDraftCardView({ card, resultKey, tone, onShowDate }: CardProps & { card: Extract<AssistantCard, { type: "eventDraft" }> }) {
  const d = card.draft;
  const { groupId, group, eventsChanged } = useGroupContext();
  const { results, setResult } = useAssistant();
  const toast = useToast();
  const create = useCreateEvent(groupId, { source: "assistant" });
  const done = results[resultKey];
  const personal = group?.type === "PERSONAL";
  const meId = group?.me.userId ?? null;
  const bar = d.members[0] ? memberColor(d.members[0].color) : MUTE;

  async function add() {
    if (done || create.isPending) return;
    const r = await create.mutate(eventInputOf(d));
    if (!r.ok) {
      toast.show(messageOf(r.error, "넣지 못했어요. 다시 시도해 주세요"));
      return;
    }
    const date = dateKeyOf(r.data.startsAt);
    setResult(resultKey, { kind: "event", title: r.data.title, date, publicCode: r.data.publicCode });
    eventsChanged();
    onShowDate?.(date);
  }

  return (
    <article aria-label={`일정 초안 ${d.title}`} className={`flex gap-3 rounded-xl p-4 ${toneClass(tone)}`}>
      <span aria-hidden="true" className="w-1 shrink-0 self-stretch rounded-full" style={{ background: bar }} />
      <div className="min-w-0 flex-1">
        <h3 className="text-[17px] font-bold leading-6 tracking-[-0.01em] [overflow-wrap:anywhere]">{d.title}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-[14px] leading-5 text-ink">
          <IconClock size={16} className="shrink-0 text-ink-2" />
          {draftWhenText(d)}
        </p>
        {/* (#566) 음력으로 말한 초안은 그 음력 날짜를 시각 줄 아래에 */}
        {draftLunarText(d) && <p className="mt-0.5 pl-[22px] text-[13px] leading-[18px] font-medium text-ink-2">{draftLunarText(d)}</p>}
        {d.place?.text && (
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[14px] leading-5 text-ink">
            <IconPin size={16} className="shrink-0 text-ink-2" />
            <span className="min-w-0 truncate">{d.place.text}</span>
          </p>
        )}
        {!personal && <MemberLine members={d.members} meId={meId} />}
        {done?.kind === "event" ? (
          <DoneLine
            text={`'${done.title}'${eulReulOf(done.title)} 넣었어요.`}
            link={<ShowInCalendar date={done.date} publicCode={done.publicCode} onShowDate={onShowDate} />}
          />
        ) : (
          <div className="mt-3 flex gap-2">
            <Link
              href={eventEditHref(d)}
              aria-label={`${d.title} 고치기`}
              className={`flex h-11 flex-1 items-center justify-center rounded-md text-[14px] font-bold text-ink hover:brightness-95 ${subtleClass(tone)}`}
            >
              고치기
            </Link>
            <Button size="lg" className="flex-[2]" loading={create.isPending} onClick={() => void add()} aria-label={`${d.title} 추가`}>
              추가
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

/** (#511) "을/를" */
const eulReulOf = (word: string) => (hasBatchim(word) ? "을" : "를");

/** 달력에서 보기 (넓은 화면 패널은 그 일정 상세, 폰은 그날 달력) */
function ShowInCalendar({ date, publicCode, onShowDate }: { date: string; publicCode: string; onShowDate?: ShowDate }) {
  return onShowDate ? (
    <button type="button" onClick={() => onShowDate(date, { publicCode })} className={linkCls}>
      달력에서 보기
    </button>
  ) : (
    <Link href={calendarHref({ date })} className={linkCls}>
      달력에서 보기
    </Link>
  );
}

/** (#511) 고치기, 지우기 카드 머리: "일정 고치기", 반복이면 "(이 일정만)" */
function TargetLabel({ text, target }: { text: string; target: EventTarget }) {
  return (
    <p className="text-[12px] leading-4 text-ink-2">
      {text}
      {target.repeat ? " (이 일정만)" : ""}
    </p>
  );
}

/** 바뀐 칸: 전 값(지운 줄) 아래 새 값. 안 바뀐 칸은 새 값만 */
function ChangeLine({ icon, before, after, changed }: { icon: React.ReactNode; before: string; after: string; changed: boolean }) {
  return (
    <div className="mt-1 flex items-start gap-1.5 text-[14px] leading-5 text-ink">
      <span className="mt-0.5 shrink-0 text-ink-2">{icon}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {changed && (
          <span className="block text-ink-2 line-through">
            <span className="sr-only">바꾸기 전: </span>
            {before}
          </span>
        )}
        <span className={changed ? "block font-bold" : "block"}>
          {changed && <span className="sr-only">바꾼 뒤: </span>}
          {after}
        </span>
      </span>
    </div>
  );
}

function EventEditDraftCardView({ card, resultKey, tone, onShowDate }: CardProps & { card: Extract<AssistantCard, { type: "eventEditDraft" }> }) {
  const { target, after } = card.draft;
  const { groupId, group, eventsChanged } = useGroupContext();
  const { results, setResult } = useAssistant();
  const toast = useToast();
  const update = useUpdateEvent(groupId, { source: "assistant" });
  const done = results[resultKey];
  const changed = editChanges(card.draft);
  const personal = group?.type === "PERSONAL";
  const meId = group?.me.userId ?? null;
  const bar = target.members[0] ? memberColor(target.members[0].color) : MUTE;

  async function save() {
    if (done || update.isPending) return;
    const r = await update.mutate({ eventId: target.id, input: eventPatchOf(card.draft), ...targetScope(target) });
    if (!r.ok) {
      toast.show(r.error.status === 404 ? "이미 삭제된 일정이에요" : messageOf(r.error, "고치지 못했어요. 다시 시도해 주세요"));
      return;
    }
    const date = dateKeyOf(r.data.startsAt);
    setResult(resultKey, { kind: "edited", title: r.data.title, date, publicCode: r.data.publicCode, occurrence: r.data.occurrence ?? null });
    toast.show(`'${r.data.title}'${eulReulOf(r.data.title)} 고쳤어요`);
    eventsChanged();
    onShowDate?.(date);
  }

  return (
    <article aria-label={`일정 고치기 ${target.title}`} className={`flex gap-3 rounded-xl p-4 ${toneClass(tone)}`}>
      <span aria-hidden="true" className="w-1 shrink-0 self-stretch rounded-full" style={{ background: bar }} />
      <div className="min-w-0 flex-1">
        <TargetLabel text="일정 고치기" target={target} />
        <h3 className="mt-0.5 text-[17px] font-bold leading-6 tracking-[-0.01em] [overflow-wrap:anywhere]">{after.title}</h3>
        {changed.title && (
          <p className="text-[13px] leading-5 text-ink-2 line-through [overflow-wrap:anywhere]">
            <span className="sr-only">바꾸기 전 제목: </span>
            {target.title}
          </p>
        )}
        <ChangeLine icon={<IconClock size={16} />} before={draftWhenText(target)} after={draftWhenText(after)} changed={changed.time} />
        {(after.place || target.place) && (
          <ChangeLine
            icon={<IconPin size={16} />}
            before={target.place?.text ?? "장소 없음"}
            after={after.place?.text ?? "장소 없음"}
            changed={changed.place}
          />
        )}
        {!personal && <MemberLine members={target.members} meId={meId} />}
        {done?.kind === "edited" ? (
          <DoneLine
            text={`'${done.title}'${eulReulOf(done.title)} 고쳤어요.`}
            link={<ShowInCalendar date={done.date} publicCode={done.publicCode} onShowDate={onShowDate} />}
          />
        ) : (
          <div className="mt-3 flex gap-2">
            <Link
              href={eventEditPageHref(target, target.occurrence ? "this" : null)}
              aria-label={`${target.title} 수정 화면에서 고치기`}
              className={`flex h-11 flex-1 items-center justify-center rounded-md text-[14px] font-bold text-ink hover:brightness-95 ${subtleClass(tone)}`}
            >
              고치기
            </Link>
            <Button size="lg" className="flex-[2]" loading={update.isPending} onClick={() => void save()} aria-label={`${target.title} 수정`}>
              수정
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function EventDeleteDraftCardView({ card, resultKey, tone }: CardProps & { card: Extract<AssistantCard, { type: "eventDeleteDraft" }> }) {
  const { target } = card;
  const { groupId, group, eventsChanged } = useGroupContext();
  const { results, setResult } = useAssistant();
  const toast = useToast();
  const remove = useDeleteEvent(groupId, { source: "assistant" });
  const deletedToast = useEventDeleteToast(groupId);
  const done = results[resultKey];
  const personal = group?.type === "PERSONAL";
  const meId = group?.me.userId ?? null;
  const bar = target.members[0] ? memberColor(target.members[0].color) : MUTE;

  async function del() {
    if (done || remove.isPending) return;
    const r = await remove.mutate({ eventId: target.id, ...targetScope(target) });
    if (!r.ok) {
      toast.show(r.error.status === 404 ? "이미 삭제된 일정이에요" : messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    setResult(resultKey, { kind: "deleted", title: target.title });
    eventsChanged();
    // (#375) 7초 안 되돌리기 (D-251)
    deletedToast(r.data.deletionId);
  }

  return (
    <article aria-label={`일정 지우기 ${target.title}`} className={`flex gap-3 rounded-xl p-4 ${toneClass(tone)}`}>
      <span aria-hidden="true" className="w-1 shrink-0 self-stretch rounded-full" style={{ background: bar }} />
      <div className="min-w-0 flex-1">
        <TargetLabel text="일정 지우기" target={target} />
        <h3 className="mt-0.5 text-[17px] font-bold leading-6 tracking-[-0.01em] [overflow-wrap:anywhere]">{target.title}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-[14px] leading-5 text-ink">
          <IconClock size={16} className="shrink-0 text-ink-2" />
          {draftWhenText(target)}
        </p>
        {target.place?.text && (
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[14px] leading-5 text-ink">
            <IconPin size={16} className="shrink-0 text-ink-2" />
            <span className="min-w-0 truncate">{target.place.text}</span>
          </p>
        )}
        {!personal && <MemberLine members={target.members} meId={meId} />}
        {done?.kind === "deleted" ? (
          <DoneLine text={`'${done.title}'${eulReulOf(done.title)} 지웠어요.`} link={null} />
        ) : done?.kind === "kept" ? (
          <p className="mt-3 flex min-h-11 items-center text-[14px] font-semibold leading-5 text-ink-2">지우지 않았어요.</p>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setResult(resultKey, { kind: "kept" })}
              disabled={remove.isPending}
              aria-label={`${target.title} 지우기 취소`}
              className={`flex h-11 flex-1 items-center justify-center rounded-md text-[14px] font-bold text-ink hover:brightness-95 disabled:text-ink-2 ${subtleClass(tone)}`}
            >
              취소
            </button>
            <Button
              size="lg"
              variant="dangerFill"
              className="flex-[2]"
              loading={remove.isPending}
              onClick={() => void del()}
              aria-label={`${target.title} 삭제`}
            >
              삭제
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function EventChoiceCardView({ card, resultKey, tone }: CardProps & { card: Extract<AssistantCard, { type: "eventChoice" }> }) {
  const { addLocal, results, setResult } = useAssistant();
  const done = results[resultKey];
  const picked = done?.kind === "picked" ? done.index : null;
  const verb = card.action === "edit" ? "고칠" : "지울";
  return (
    <article aria-label={`${verb} 일정 고르기`} className={`rounded-xl px-4 pb-3 pt-3.5 ${toneClass(tone)}`}>
      <p className="text-[12px] leading-4 text-ink-2">{verb} 일정을 골라 주세요</p>
      <ul className="mt-1 divide-y divide-line">
        {card.options.map((option, i) => {
          const t = option.target;
          return (
            <li key={`${t.id}:${t.occurrence ?? ""}`}>
              <button
                type="button"
                disabled={picked !== null}
                onClick={() => {
                  const next = cardOfChoice(card.action, option);
                  if (!next) return;
                  setResult(resultKey, { kind: "picked", index: i });
                  addLocal(next);
                }}
                aria-label={`${t.title} ${draftWhenText(t)} 고르기`}
                className="flex min-h-14 w-full items-center gap-3 py-1.5 text-left disabled:cursor-default"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold leading-5">{t.title}</span>
                  <span className="block text-[13px] leading-[18px] text-ink-2">{draftWhenText(t)}</span>
                </span>
                {picked === i ? (
                  <IconCheck size={18} className="shrink-0 text-acc-ink" />
                ) : (
                  <span className={`shrink-0 text-[13px] font-bold ${picked === null ? "text-btn" : "text-ink-2"}`}>고르기</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {card.more > 0 && <p className="mt-1 text-[12px] leading-4 text-ink-2">외 {card.more}개는 날짜를 넣어 다시 말해 주세요</p>}
    </article>
  );
}

function FreeSlotsCardView({ card, resultKey, tone }: CardProps & { card: Extract<AssistantCard, { type: "freeSlots" }> }) {
  const { group } = useGroupContext();
  const { addLocal, results, setResult } = useAssistant();
  const members = group?.members ?? [];
  const showPoll = canPollFrom(card.slots, { personal: group?.type === "PERSONAL", memberCount: members.length });
  const k = Math.min(card.slots.length, 5);
  const drafted = results[resultKey]?.kind === "drafted";
  return (
    <article aria-label="빈 시간" className={`rounded-xl px-4 pb-3 pt-3.5 ${toneClass(tone)}`}>
      <p className="text-[12px] leading-4 text-ink-2">{freeQueryText(card.query)}</p>
      <ul className="mt-1 divide-y divide-line">
        {card.slots.map((s) => {
          const day = formatDateKo(dateKeyOf(s.startsAt));
          const time = slotTimeText(s);
          return (
            <li key={`${s.startsAt}|${s.endsAt}`} className="flex min-h-14 items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold leading-[18px]">{day}</span>
                <span className="block text-[15px] font-bold leading-5 text-acc-ink tabular-nums">{time}</span>
              </span>
              <Link
                href={slotEditHref(s, card.query, card.pollTitle)}
                aria-label={`${day} ${time} 이 시간으로 일정`}
                className="flex h-11 shrink-0 items-center px-1 text-[13px] font-bold text-btn"
              >
                이 시간으로 일정
              </Link>
            </li>
          );
        })}
      </ul>
      {showPoll && (
        <button
          type="button"
          disabled={drafted}
          onClick={() => {
            setResult(resultKey, { kind: "drafted" });
            addLocal(pollDraftFromSlots(card, members));
          }}
          className={`mt-2 flex h-11 w-full items-center justify-center rounded-md text-[14px] font-bold text-ink hover:brightness-95 disabled:text-ink-2 ${subtleClass(tone)}`}
        >
          이 {k}개로 투표 열기
        </button>
      )}
    </article>
  );
}

function PollDraftCardView({ card, resultKey, tone }: CardProps & { card: Extract<AssistantCard, { type: "pollDraft" }> }) {
  const d = card.draft;
  const { groupId, group } = useGroupContext();
  const { results, setResult } = useAssistant();
  const toast = useToast();
  const create = useCreatePoll(groupId, { source: "assistant-poll" });
  const [editing, setEditing] = useState(false);
  const done = results[resultKey];
  const meId = group?.me.userId ?? null;
  const today = todayKey();

  async function open() {
    if (done || create.isPending) return;
    const r = await create.mutate(pollInputOf(d));
    if (!r.ok) {
      toast.show(messageOf(r.error, "투표를 열지 못했어요. 다시 시도해 주세요"));
      return;
    }
    setResult(resultKey, { kind: "poll", href: pollHref(r.data) });
  }

  return (
    <article aria-label={`투표 초안 ${d.title}`} className={`rounded-xl p-4 ${toneClass(tone)}`}>
      <p className="text-[12px] leading-4 text-ink-2">투표 초안</p>
      <h3 className="mt-0.5 text-[17px] font-bold leading-6 tracking-[-0.01em] [overflow-wrap:anywhere]">{d.title}</h3>
      <ul className="mt-2 space-y-1">
        {d.options.map((o) => (
          <li key={`${o.startsAt}|${o.endsAt}`} className="flex items-baseline gap-2 text-[14px] leading-5">
            <span className="font-semibold">{dateKeyOf(o.startsAt) === today ? "오늘" : formatDateKo(dateKeyOf(o.startsAt))}</span>
            <span className="tabular-nums text-ink-2">{slotTimeText(o)}</span>
          </li>
        ))}
      </ul>
      <MemberLine members={card.members} meId={meId} />
      {done?.kind === "poll" ? (
        <DoneLine
          text="투표를 열었어요."
          link={
            <Link href={done.href} className={linkCls}>
              투표 보기
            </Link>
          }
        />
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-haspopup="dialog"
            aria-label={`${d.title} 투표 고치기`}
            className={`flex h-11 flex-1 items-center justify-center rounded-md text-[14px] font-bold text-ink hover:brightness-95 ${subtleClass(tone)}`}
          >
            고치기
          </button>
          <Button size="lg" className="flex-[2]" loading={create.isPending} onClick={() => void open()} aria-label={`${d.title} 투표 열기`}>
            투표 열기
          </Button>
        </div>
      )}
      <PollCreateSheet
        open={editing}
        onClose={() => setEditing(false)}
        groupId={groupId}
        members={group?.members ?? []}
        meId={meId}
        slots={d.options}
        minMinutes={pollSheetMinutes(d.options)}
        initialTitle={d.title}
        initialParticipants={d.participants}
        clientSource="assistant-edit"
        onCreated={(poll) => {
          setEditing(false);
          setResult(resultKey, { kind: "poll", href: pollHref(poll) });
          toast.show("투표를 열었어요");
        }}
      />
    </article>
  );
}

function EventListCardView({ card, tone }: CardProps & { card: Extract<AssistantCard, { type: "eventList" }> }) {
  const { groupId, group } = useGroupContext();
  const who = { meId: group?.me.userId ?? null, personal: group?.type === "PERSONAL" };
  const rows: Event[] = card.events.map((e) => rowEventOf(e, groupId));
  if (rows.length === 0 && card.days.length === 0) return null;
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <EventList label="찾은 일정" className={tone === "surface" ? "!bg-surface" : ""}>
          {rows.map((ev) => (
            <EventRow key={`${ev.id}:${ev.occurrence ?? ""}`} event={ev} who={who} dateText={formatDateKo(dateKeyOf(ev.startsAt))} />
          ))}
          {card.more > 0 && (
            <li className="border-t border-line">
              <Link href={calendarHref({ date: dateKeyOf(card.from) })} className="flex min-h-11 items-center gap-1 px-3.5 text-[13px] font-bold text-btn">
                외 {card.more}개 달력에서 보기
                <IconChevronRight size={14} />
              </Link>
            </li>
          )}
        </EventList>
      )}
      {card.days.length > 0 && (
        <ul aria-label="기념일과 생일" className={`divide-y divide-line rounded-xl px-3.5 ${toneClass(tone)}`}>
          {card.days.map((day) => (
            <li key={`${day.kind}:${day.name}:${day.date}`} className="flex min-h-14 items-center gap-2.5 py-2">
              <IconHeart size={18} className="shrink-0 text-acc-ink" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold leading-5">{day.name}</span>
                <span className="block text-[13px] leading-[18px] text-ink-2">{formatDateKo(day.date)}</span>
              </span>
              <b className="shrink-0 text-[15px] font-bold text-acc-ink">{ddayText(day.dday)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClarifyView({ card, tone }: { card: Extract<AssistantCard, { type: "clarify" }>; tone: CardTone }) {
  const { send, pending, limited } = useAssistant();
  if (card.choices.length === 0) return null;
  return (
    <div role="group" aria-label="누구인지 고르기" className="flex flex-wrap gap-2">
      {card.choices.map((m) => (
        <button
          key={m.userId ?? m.displayName}
          type="button"
          disabled={pending || limited}
          onClick={() => void send(m.displayName)}
          className={`flex h-11 items-center gap-1.5 rounded-full pl-1.5 pr-4 text-[14px] font-bold text-ink hover:bg-hover disabled:text-ink-2 ${pillClass(tone)}`}
        >
          <Avatar member={m} color={m.color} size={28} />
          {m.displayName}
        </button>
      ))}
    </div>
  );
}
