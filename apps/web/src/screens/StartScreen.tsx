"use client";
// (#278) 팀 만들기 직후 첫 단계 한 장 `/groups/start?preset=`. 단독 화면(독 없음), 위 "건너뛰기", 제목 28/36(진입 화면 공통 #174 L4)
// 커플: 처음 만난 날 기념일 / 가족: 내 생일 넣기(#305, 내 정보로) / 친구: 초대 뒤 빈 시간과 투표 안내 / 스터디: 매주 정기 모임 일정.
// 끝나거나 건너뛰면 초대 화면으로(replace, 뒤로가기로 돌아오지 않는다). 달력 시작 안내에서 다시 열었으면(from=calendar) 달력으로
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { GroupGone } from "@/components/GroupGone";
import { Symbol } from "@/components/Logo";
import { IconCalendar, IconFree, IconHeart, IconPoll, IconTeam } from "@/components/icons";
import { NameField } from "@/components/NameField";
import { DatePicker, TimePicker } from "@/components/pickers";
import { Button, InlineError, RowGroup, Segmented } from "@/components/ui";
import { messageOf, useCreateAnniversary, useCreateEvent, useGroup, useMe } from "@/hooks";
import { formatBirthday } from "@/lib/birthday";
import { dowOf, formatDateKo, todayKey } from "@/lib/date";
import { ME_BIRTHDAY_PATH } from "@/lib/routes";
import { finishStep } from "@/lib/start-guide";
import {
  afterStartHref,
  FIRST_MEET_NAME,
  firstMeetInput,
  firstMeetingDate,
  firstMeetPreview,
  MEETING_TITLE,
  meetingValid,
  weeklyMeetingInput,
  type PresetKey,
} from "@/lib/team-preset";

type Props = { groupId: number; preset: PresetKey; fromCalendar: boolean };

export function StartScreen({ groupId, preset, fromCalendar }: Props) {
  const router = useRouter();
  // 멤버가 아니거나 없는 팀이면 팀 화면들과 같은 안내 (주소를 직접 연 경우)
  const { error } = useGroup(groupId);
  const next = afterStartHref(fromCalendar);
  const go = () => router.replace(next);

  if (error && (error.status === 403 || error.status === 404)) return <GroupGone />;

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] lg:pt-6">
      <div className="flex items-center justify-between">
        <Symbol size={32} />
        {/* 첫 단계는 늘 건너뛸 수 있다. 건너뛰면 달력 위 시작 안내로 한 번 더 */}
        <button type="button" onClick={go} className="hit flex h-8 items-center rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95">
          건너뛰기
        </button>
      </div>
      {preset === "two" && <FirstMeetStep groupId={groupId} onDone={go} />}
      {preset === "family" && <BirthdayStep groupId={groupId} onDone={go} />}
      {preset === "friends" && <FriendsStep onDone={go} fromCalendar={fromCalendar} />}
      {preset === "study" && <MeetingStep groupId={groupId} onDone={go} />}
    </main>
  );
}

function Title({ lines, sub }: { lines: [string, string]; sub: string }) {
  return (
    <>
      <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">
        {lines[0]}
        <br />
        {lines[1]}
      </h1>
      <p className="mt-2 text-[14px] leading-5 text-soft">{sub}</p>
    </>
  );
}

// (#378) 버튼은 내용 바로 아래 (화면 맨 아래로 떨어뜨리지 않는다, 팀 만들기와 같다)
const formClass = "mt-8 flex flex-col";
const cardClass = "mt-6 space-y-3 rounded-lg bg-paper px-3.5 py-3.5";
const footClass = "mt-5";

/* ---------- 커플: 처음 만난 날 ---------- */

function FirstMeetStep({ groupId, onDone }: { groupId: number; onDone: () => void }) {
  const [name, setName] = useState(FIRST_MEET_NAME);
  const [date, setDate] = useState(todayKey);
  const { mutate, isPending, error } = useCreateAnniversary(groupId, { keepPendingAfterSuccess: true });
  const valid = name.trim().length <= 30;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || isPending) return;
    const r = await mutate(firstMeetInput(name, date));
    if (!r.ok) return;
    finishStep(groupId, "first");
    onDone();
  }

  return (
    <form onSubmit={submit} className={formClass}>
      <Title lines={["처음 만난 날이", "언제예요?"]} sub="넣어 두면 100일, 1주년이 달력에 저절로 떠요" />
      {/* (#378) 이름 칸(라벨 없음) + 날짜 줄 한 카드, 미리보기 한 줄 */}
      <RowGroup className="mt-6">
        <NameField label="기념일 이름" value={name} onChange={setName} max={30} limitInput placeholder={FIRST_MEET_NAME} autoComplete="off" />
        <DatePicker look="row" rowLabel="날짜" rowIcon={<IconCalendar size={18} />} label="처음 만난 날" value={date} onChange={setDate} withYear />
        <p className="flex items-center gap-1.5 py-2.5 text-[13px] font-medium leading-5 text-acc-ink">
          <IconHeart size={16} className="shrink-0" />
          {firstMeetPreview(date)}
        </p>
      </RowGroup>
      {error && <InlineError className="mt-2 px-1">{messageOf(error, "저장하지 못했어요. 다시 시도해 주세요")}</InlineError>}
      <div className={footClass}>
        <Button type="submit" size="xl" full disabled={!valid} loading={isPending}>
          추가
        </Button>
      </div>
    </form>
  );
}

/* ---------- 가족: 내 생일 (#305) ---------- */

function BirthdayStep({ groupId, onDone }: { groupId: number; onDone: () => void }) {
  const { data: me } = useMe();
  const mine = formatBirthday(me?.birthday?.date);

  return (
    <div className={formClass}>
      <Title lines={["가족 생일을", "챙겨 볼까요?"]} sub="각자 내 정보에 생일을 넣으면 이 달력에 매년 떠요. 태어난 해는 묻지 않아요" />
      <div className={cardClass}>
        <div className="flex min-h-11 items-center gap-3">
          <IconHeart size={18} className="shrink-0 text-acc-ink" />
          <span className="text-[14px] font-semibold">내 생일</span>
          <span className="ml-auto text-[14px] text-ink-2">{me === null ? "" : (mine ?? "아직 없어요")}</span>
        </div>
        <p className="t-sub">가족이 들어오면 각자 자기 생일을 넣을 수 있어요</p>
      </div>
      <div className={footClass}>
        {mine ? (
          <Button
            size="xl"
            full
            onClick={() => {
              finishStep(groupId, "birthday");
              onDone();
            }}
          >
            다음
          </Button>
        ) : (
          // 내 정보의 생일 시트를 연 채로 간다 (/me#birthday)
          <Link
            href={ME_BIRTHDAY_PATH}
            onClick={() => finishStep(groupId, "birthday")}
            className="flex h-12 w-full items-center justify-center rounded-md bg-btn px-5 text-[15px] font-bold text-on-btn hover:brightness-95"
          >
            내 생일 넣기
          </Link>
        )}
      </div>
    </div>
  );
}

/* ---------- 친구: 초대 → 빈 시간 → 투표 ---------- */

function FriendsStep({ onDone, fromCalendar }: { onDone: () => void; fromCalendar: boolean }) {
  const rows = [
    { icon: <IconTeam size={18} />, text: "친구들을 초대해요" },
    { icon: <IconFree size={18} />, text: "모두 비는 시간을 찾아요" },
    { icon: <IconPoll size={18} />, text: "후보를 골라 투표로 정해요" },
  ];
  return (
    <div className={formClass}>
      <Title lines={["첫 모임을", "잡아 볼까요?"]} sub="친구들이 들어오면 빈 시간 찾기로 약속을 잡아요" />
      <ol className={cardClass}>
        {rows.map((r, i) => (
          <li key={r.text} className="flex min-h-11 items-center gap-3">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-hover text-acc-ink">
              {r.icon}
            </span>
            <span className="text-[14px] font-semibold">
              <span className="sr-only">{i + 1}단계, </span>
              {r.text}
            </span>
          </li>
        ))}
      </ol>
      <div className={footClass}>
        <Button size="xl" full onClick={onDone}>
          {fromCalendar ? "달력으로" : "초대하러 가기"}
        </Button>
      </div>
    </div>
  );
}

/* ---------- 스터디: 매주 정기 모임 ---------- */

// 월요일부터 (값은 dowOf 의 0=일)
const DOW_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: "일월화수목금토"[d] }));

function MeetingStep({ groupId, onDone }: { groupId: number; onDone: () => void }) {
  const dowLabelId = useId();
  const [title, setTitle] = useState(MEETING_TITLE);
  const [dow, setDow] = useState(() => dowOf(todayKey()));
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("21:00");
  const { mutate, isPending, error } = useCreateEvent(groupId, { keepPendingAfterSuccess: true });
  const meeting = { title, dow, start, end };
  const valid = meetingValid(meeting);
  const first = firstMeetingDate(dow, start);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || isPending) return;
    const r = await mutate(weeklyMeetingInput(meeting));
    if (!r.ok) return;
    finishStep(groupId, "first");
    onDone();
  }

  return (
    <form onSubmit={submit} className={formClass}>
      <Title lines={["정기 모임이", "있나요?"]} sub="요일과 시간을 넣으면 매주 달력에 들어가요" />
      {/* (#378) 모임 이름 칸(라벨 없음) → 요일 세그먼트 → 시간 줄, 안내 한 줄 */}
      <RowGroup className="mt-6" hint={start >= end ? undefined : `첫 모임은 ${formatDateKo(first)}, 그 뒤로 매주 같은 요일이에요`}>
        <NameField label="모임 이름" value={title} onChange={setTitle} max={50} limitInput placeholder={MEETING_TITLE} autoComplete="off" />
        <div className="pb-3 pt-2.5">
          <span id={dowLabelId} className="mb-2 block text-[14px] font-semibold">
            요일
          </span>
          <Segmented labelledBy={dowLabelId} value={String(dow)} options={DOW_OPTIONS} onChange={(v) => setDow(Number(v))} />
        </div>
        <div className="flex min-h-12 items-center gap-2 py-1.5">
          <span aria-hidden="true" className="shrink-0 text-[14px] font-semibold">
            시간
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <TimePicker look="chip" label="시작 시각" value={start} onChange={setStart} />
            <span aria-hidden="true" className="text-ink-2">
              ~
            </span>
            <TimePicker look="chip" label="끝 시각" value={end} onChange={setEnd} aria-invalid={start >= end} />
          </div>
        </div>
        {start >= end && <InlineError className="py-2">끝 시각이 시작보다 늦어야 해요</InlineError>}
      </RowGroup>
      {error && <InlineError className="mt-2 px-1">{messageOf(error, "저장하지 못했어요. 다시 시도해 주세요")}</InlineError>}
      <div className={footClass}>
        <Button type="submit" size="xl" full disabled={!valid} loading={isPending}>
          추가
        </Button>
      </div>
    </form>
  );
}
