"use client";
// (#450) AI 비서 카드 (설계 AI-비서.md 7-6, 7-7, 승인 시안). 볼까 말풍선 아래 전체 폭 카드.
//   eventDraft  4px 색 막대 + 제목 17/700 + 날짜 시각 + 장소(핀) + 참여자 아바타와 이름 / [고치기] [추가]
//   freeSlots   조건 한 줄 + 줄(날짜 600, 시각 코랄 700, "이 시간으로 일정") + [이 N개로 투표 열기]
//   pollDraft   제목 + 후보 줄 + 대상 아바타 / [고치기](PollCreateSheet) [투표 열기]
//   eventList   공통 일정 줄(EventRow) 최대 10개 + "외 N개" + 기념일, 생일 줄
//   clarify     이름 알약(누르면 그 이름을 보낸다), unsupported 링크 알약. refusal 은 말풍선만
// 저장은 기존 훅(useCreateEvent, useCreatePoll)으로만 하고 X-Client-Source 를 싣는다 (6-1). 같은 카드의 저장은 한 번만
import Link from "next/link";
import { useState } from "react";
import { useGroupContext } from "./AppShell";
import { useAssistant } from "./AssistantProvider";
import { EventList, EventRow } from "./EventRow";
import { IconCheck, IconChevronRight, IconClock, IconHeart, IconPin } from "./icons";
import { PollCreateSheet } from "./PollCreateSheet";
import { useToast } from "./Toast";
import { Avatar, Button } from "./ui";
import { messageOf, useCreateEvent, useCreatePoll } from "@/hooks";
import {
  canPollFrom,
  ddayText,
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
} from "@/lib/assistant";
import { memberColor } from "@/lib/colors";
import { dateKeyOf, formatDateKo, todayKey } from "@/lib/date";
import { MUTE } from "@/lib/participants";
import { calendarHref, pollHref } from "@/lib/routes";
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
  /** 넓은 화면 패널: [추가] 뒤 달력이 그날을 보이게 (주면 "달력에서 보기" 가 이동 대신 이것을 부른다) */
  onShowDate?: (date: string) => void;
};

export function AssistantCardView({ card, ...rest }: CardProps & { card: AssistantCard }) {
  switch (card.type) {
    case "eventDraft":
      return <EventDraftCardView card={card} {...rest} />;
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
        <Link href={card.link.href} className={`inline-flex h-11 items-center gap-1 rounded-full px-4 text-[14px] font-bold text-ink hover:bg-hover ${pillClass(rest.tone)}`}>
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
    setResult(resultKey, { kind: "event", title: r.data.title, date });
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
        {d.place?.text && (
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[14px] leading-5 text-ink">
            <IconPin size={16} className="shrink-0 text-ink-2" />
            <span className="min-w-0 truncate">{d.place.text}</span>
          </p>
        )}
        {!personal && <MemberLine members={d.members} meId={meId} />}
        {done?.kind === "event" ? (
          <DoneLine
            text={`'${done.title}'을 넣었어요.`}
            link={
              onShowDate ? (
                <button type="button" onClick={() => onShowDate(done.date)} className={linkCls}>
                  달력에서 보기
                </button>
              ) : (
                <Link href={calendarHref({ date: done.date })} className={linkCls}>
                  달력에서 보기
                </Link>
              )
            }
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
