/**
 * (#458) 볼까 실제 모델 확인 스크립트 (선택, CI 에서 돌리지 않음. 설계 AI-비서.md 5-2).
 * 운영과 같은 지시문, 도구, 가드, 정규화로 실제 OpenAI 모델에 날짜, 참여자 문장을 보내고 서버가 정한 날짜를 기대값과 비교한다.
 * 기준 시각은 운영 재현 날 2026-11-16 (월) 14:05 KST 로 고정한다(모델에도 그 날을 오늘로 준다). 팀은 "경"(나), "김수경".
 *
 * 실행 (apps/api 에서, 키는 환경 변수로만. 이 스크립트는 키를 출력하지 않는다):
 *   OPENAI_API_KEY=... pnpm dlx tsx@4 scripts/assistant-live-eval.ts
 *   OPENAI_MODEL=gpt-4o-mini 처럼 (기본 gpt-4.1-mini) 모델을 바꿀 수 있다
 * 하나라도 틀리면 종료 코드 1. 문장 하나당 모델 호출 1번 (약 30번).
 * (#474) 일정 초안은 events 의 일정마다 "event 날짜 시각 [참여자]" 를 말한 순서대로 " | " 로 잇는다 (일정 하나면 예전과 같은 한 줄)
 * (#511) 고치기, 지우기는 DB 대신 아래 FIXTURE 일정(반복은 회차로 펼친 것)에서 서비스와 같은 규칙으로 찾는다 (D-283).
 *   고치기 1개 "edit 제목@대상날짜 → 제목 날짜 시각~시각", 지우기 1개 "delete 제목@날짜[ 회차]", 여럿 "choice edit|delete N", 못 찾음 "notfound"
 */
import { OpenAiAssistantModel } from '../src/assistant/openai-model.js';
import { DEFAULT_OPENAI_MODEL } from '../src/assistant/assistant-model.js';
import { decide } from '../src/assistant/guard.js';
import {
  NormalizeProblem,
  normalizeDraftEvents,
  normalizeFindAnniversary,
  normalizeFreeTime,
  normalizeListEvents,
  type DraftEventsArgs,
  type FindAnniversaryArgs,
  type FindFreeTimeArgs,
  type ListEventsArgs,
  type NormalizeContext,
} from '../src/assistant/normalize.js';
import { buildMessages } from '../src/assistant/prompt.js';
import { editTargetArgs, type FindEditArgs, hasChanges, matchTargets, normalizeEdit, type TargetArgs, targetSearch, toTarget } from '../src/assistant/targets.js';
import { ASSISTANT_TOOLS } from '../src/assistant/tools.js';

/** 2026-11-16 (월) 14:05 KST */
const NOW = new Date('2026-11-16T05:05:00.000Z');
const TEAM = [
  { userId: 1, name: '경' },
  { userId: 2, name: '김수경' },
];

/** (#511) 고치기, 지우기 대상 일정 (DB 대신). 반복 "주간 회의" 는 매주 월 10:00 회차로 펼쳐 둔다 */
const at = (text: string): Date => new Date(`${text.replace(' ', 'T')}:00.000+09:00`);
const fixture = (id: number, title: string, start: string, end: string, occurrence: string | null = null) => ({
  id,
  publicCode: `code${id}`,
  occurrence,
  repeat: occurrence ? 'WEEKLY' : null,
  title,
  startsAt: at(start),
  endsAt: at(end),
  allDay: false,
  place: null,
  participants: { members: [] },
});
const FIXTURE = [
  fixture(1, '회식', '2026-11-20 19:00', '2026-11-20 21:00'),
  fixture(2, '영화', '2026-11-17 20:00', '2026-11-17 22:00'),
  fixture(3, '병원', '2026-11-18 15:00', '2026-11-18 16:00'),
  fixture(4, '점심', '2026-11-19 12:00', '2026-11-19 13:00'),
  fixture(5, '점심', '2026-11-24 12:00', '2026-11-24 13:00'),
  ...['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'].map((date) => fixture(6, '주간 회의', `${date} 10:00`, `${date} 11:00`, date)),
];

interface Case {
  text: string;
  /** 기대 결과를 한 줄 글자로 (아래 summarize 와 같은 모양) */
  expected: string;
  /** 같이 맞다고 보는 결과 (시각을 말하지 않은 하루 행사처럼 종일과 되묻기가 둘 다 맞는 것) */
  accept?: string[];
}

const CASES: Case[] = [
  {
    text: '다음 주 금요일 7시 강남 회식 잡아줘',
    expected: 'event 2026-11-27 19:00 [경]',
  },
  {
    text: '이번 주 금요일 저녁 7시 강남 회식',
    expected: 'event 2026-11-20 19:00 [경]',
  },
  {
    text: '11월 27일 금요일 저녁 7시 강남 회식',
    expected: 'event 2026-11-27 19:00 [경]',
  },
  { text: '금요일 저녁 7시 회식', expected: 'event 2026-11-20 19:00 [경]' },
  {
    text: '내일 점심 12시 반 수경이랑 밥',
    expected: 'event 2026-11-17 12:30 [경, 김수경]',
  },
  { text: '모레 오후 3시 회의', expected: 'event 2026-11-18 15:00 [경]' },
  {
    text: '다음 주 월요일 오전 10시 병원',
    expected: 'event 2026-11-23 10:00 [경]',
  },
  { text: '월요일 오전 9시 회의', expected: 'event 2026-11-23 09:00 [경]' },
  {
    text: '다다음 주 토요일 저녁 6시 다 같이 저녁',
    expected: 'event 2026-12-05 18:00 [경, 김수경]',
  },
  { text: '12월 3일 저녁 7시 송년회', expected: 'event 2026-12-03 19:00 [경]' },
  {
    text: '1월 5일 오전 10시 신년 회의',
    expected: 'event 2027-01-05 10:00 [경]',
  },
  {
    text: '11월 30일 하루 종일 워크숍',
    expected: 'event 2026-11-30 종일 [경]',
  },
  { text: '이번 주 일요일 저녁 7시 영화', expected: 'clarify date' },
  { text: '금요일에 회의', expected: 'clarify time' },
  {
    text: '다음 주 빈 시간 찾아줘',
    expected: 'free 2026-11-22~2026-11-28 [경, 김수경]',
  },
  {
    text: '이번 주말 수경이랑 되는 시간',
    expected: 'free 2026-11-21~2026-11-22 [경, 김수경]',
  },
  {
    text: '오늘부터 일주일 동안 둘 다 되는 저녁',
    expected: 'free 2026-11-16~2026-11-22 [경, 김수경]',
  },
  { text: '이번 주에 뭐 있어?', expected: 'list 2026-11-15~2026-11-21 -' },
  {
    text: '다음 주 수경이 일정 뭐 있어?',
    expected: 'list 2026-11-22~2026-11-28 김수경',
  },
  { text: '다음 달 기념일 뭐 있어?', expected: 'days 2026-12-01~2026-12-31' },
  { text: '내일 서울 날씨 어때?', expected: 'refusal' },
  // (#474) 한 글의 일정 여러 개 → 초안 여러 개 (말한 순서, 이름은 그 일정에만)
  {
    text: '내일 저녁 7시 회식, 토요일 오후 2시 영화',
    expected: 'event 2026-11-17 19:00 [경] | event 2026-11-21 14:00 [경]',
  },
  {
    text: '내일 점심 12시 수경이랑 밥, 금요일 저녁 7시 회식, 다음 주 월요일 오전 10시 병원',
    expected:
      'event 2026-11-17 12:00 [경, 김수경] | event 2026-11-20 19:00 [경] | event 2026-11-23 10:00 [경]',
  },
  // (#511) 고치기, 지우기 (D-283). 대상은 FIXTURE 에서 찾는다
  {
    text: '금요일 회식 7시 반으로 바꿔줘',
    expected: 'edit 회식@2026-11-20 → 회식 2026-11-20 19:30~21:30',
  },
  {
    text: '병원 예약 목요일로 옮겨줘',
    expected: 'edit 병원@2026-11-18 → 병원 2026-11-19 15:00~16:00',
  },
  {
    text: '내일 영화 제목을 심야 영화로 바꿔줘',
    expected: 'edit 영화@2026-11-17 → 심야 영화 2026-11-17 20:00~22:00',
  },
  { text: '내일 영화 취소해줘', expected: 'delete 영화@2026-11-17' },
  {
    text: '다음 주 월요일 주간 회의 지워줘',
    expected: 'delete 주간 회의@2026-11-23 회차',
  },
  { text: '점심 약속 지워줘', expected: 'choice delete 2' },
  // (#584) 음력, 윤달. 기준 날 음력 2026-10-08. 기대 양력은 src/common/lunar.ts 로 셈한 값이고, 음력으로 넣은 일정은 끝에 " 음력"
  { text: '음력 3월 15일 할머니 생신', expected: 'event 2027-04-21 종일 [경] 음력', accept: ['clarify time'] },
  // 윤4월은 음력 2025~2028 에 없어 해마다 규칙(D-297)처럼 평달 4월 10일
  { text: '음력 윤4월 10일 저녁 8시 할아버지 제사', expected: 'event 2027-05-15 20:00 [경] 음력' },
  { text: '윤달 4월 10일 제사', expected: 'event 2027-05-15 종일 [경] 음력', accept: ['clarify time'] },
  // 해를 말한 윤달은 그 해 그 윤달 그대로 (음력 2028년 윤5월 5일 = 양력 2028-06-27)
  { text: '음력 2028년 윤5월 5일 저녁 7시 가족 모임', expected: 'event 2028-06-27 19:00 [경] 음력' },
  { text: '매년 음력 8월 15일 성묘', expected: 'unsupported repeat' },
  // 음력 10월 1일 = 2026-11-09. 월일 표현처럼 31일 전까지는 올해로 본다
  { text: '음력으로 10월 초하루 오전 10시 고사', expected: 'event 2026-11-09 10:00 [경] 음력' },
  // 그믐 = 그 달 마지막 날. 이번 음력 달(10월, 30일까지) 그믐 = 2026-12-08
  { text: '음력 그믐 저녁 7시 가족 식사', expected: 'event 2026-12-08 19:00 [경] 음력' },
  // 다음 음력 달(11월) 보름 = 2026-12-23
  { text: '다음 달 음력 보름 저녁 8시 달맞이', expected: 'event 2026-12-23 20:00 [경] 음력' },
  { text: '음력 12월 3일 저녁 7시 가족 모임', expected: 'event 2027-01-10 19:00 [경] 음력' },
  { text: '엄마 생신 음력 2월 3일 매년', expected: 'unsupported anniversary_create', accept: ['unsupported repeat'] },
  // 음력 2026년에는 윤10월이 없다 (윤달은 2025년 6월, 2028년 5월)
  { text: '음력 2026년 윤10월 5일 저녁 7시 모임', expected: 'clarify date' },
];

const nameOf = (ids: readonly number[]): string =>
  `[${TEAM.filter((m) => ids.includes(m.userId))
    .map((m) => m.name)
    .join(', ')}]`;
const kst = (iso: string): { date: string; time: string } => {
  const local = new Date(
    new Date(iso).getTime() + 9 * 60 * 60 * 1000,
  ).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
};

function contextFor(text: string): NormalizeContext {
  return {
    now: NOW,
    userId: 1,
    personal: false,
    spoken: text,
    text,
    members: TEAM.map((m) => ({
      userId: m.userId,
      displayName: m.name,
      nickname: m.name,
      member: {
        userId: m.userId,
        displayName: m.name,
        color: '#F26D6D',
        profileImageUrl: null,
      },
    })),
  };
}

/** 가드 + 정규화 결과 → 한 줄 */
function summarize(
  outcome: ReturnType<typeof decide>,
  context: NormalizeContext,
): string {
  if (outcome.kind !== 'tool') return outcome.kind;
  try {
    switch (outcome.name) {
      case 'draft_event': {
        // 서비스와 같은 정규화 (앞 5개, 하나라도 되물으면 되묻기, D-280)
        const cards = normalizeDraftEvents(
          outcome.args as unknown as DraftEventsArgs,
          context,
        );
        return cards
          .map((card) => {
            const start = kst(card.startsAt);
            return `event ${start.date} ${card.allDay ? '종일' : start.time} ${nameOf(card.participants)}${card.lunarInput ? ' 음력' : ''}`;
          })
          .join(' | ');
      }
      case 'find_free_time': {
        const plan = normalizeFreeTime(
          outcome.args as unknown as FindFreeTimeArgs,
          context,
        );
        return `free ${plan.fromDate}~${plan.toDate} ${nameOf(plan.participants)}`;
      }
      case 'list_events': {
        const plan = normalizeListEvents(
          outcome.args as unknown as ListEventsArgs,
          context,
        );
        return `list ${plan.fromDate}~${plan.toDate} ${plan.memberId === null ? '-' : nameOf([plan.memberId]).slice(1, -1)}`;
      }
      case 'find_anniversary': {
        const plan = normalizeFindAnniversary(
          outcome.args as unknown as FindAnniversaryArgs,
          context,
        );
        return `days ${plan.fromDate}~${plan.toDate}`;
      }
      case 'find_event_to_edit': {
        const args = editTargetArgs(outcome.args as unknown as FindEditArgs);
        if (!hasChanges(args.changes)) return 'clarify change';
        const targets = matchTargets(FIXTURE, targetSearch(args, context), NOW).map(toTarget);
        const drafts = targets.flatMap((target) => {
          const after = normalizeEdit(target, args.changes, context);
          return after ? [{ target, after }] : [];
        });
        if (targets.length === 0) return 'notfound';
        if (drafts.length !== 1) return drafts.length === 0 ? 'already' : `choice edit ${drafts.length}`;
        const { target, after } = drafts[0];
        const start = kst(after.startsAt);
        const end = kst(after.endsAt);
        return `edit ${target.title}@${kst(target.startsAt).date} → ${after.title} ${start.date} ${after.allDay ? '종일' : `${start.time}~${end.time}`}`;
      }
      case 'find_event_to_delete': {
        const targets = matchTargets(FIXTURE, targetSearch(outcome.args as unknown as TargetArgs, context), NOW).map(toTarget);
        if (targets.length === 0) return 'notfound';
        if (targets.length > 1) return `choice delete ${targets.length}`;
        return `delete ${targets[0].title}@${kst(targets[0].startsAt).date}${targets[0].occurrence ? ' 회차' : ''}`;
      }
      case 'report_unsupported':
        return `unsupported ${(outcome.args as { action: string }).action}`;
      case 'ask_clarification':
        return `clarify ${(outcome.args as { field: string }).field}`;
      default:
        return outcome.name;
    }
  } catch (error) {
    if (error instanceof NormalizeProblem)
      return error.problem.kind === 'clarify'
        ? `clarify ${error.problem.field}`
        : error.problem.kind;
    throw error;
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error('OPENAI_API_KEY 환경 변수가 없어 실행하지 않습니다');
    process.exit(2);
  }
  const modelName = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const model = OpenAiAssistantModel.create(apiKey, modelName);
  console.log(
    `모델 ${modelName}, 기준 2026-11-16 (월) 14:05 KST, 팀 경(나), 김수경\n`,
  );

  // EVAL_ONLY=3,5 처럼 1부터 센 번호만 다시 돌릴 수 있다 (실모델 호출을 아끼려고)
  const only = (process.env.EVAL_ONLY ?? '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const cases = only.length > 0 ? CASES.filter((_, i) => only.includes(i + 1)) : CASES;
  let failed = 0;
  for (const { text, expected, accept = [] } of cases) {
    const context = contextFor(text);
    const messages = buildMessages(
      {
        now: NOW,
        personalTeam: false,
        members: TEAM.map((m) => ({ displayName: m.name, me: m.userId === 1 })),
      },
      [],
      text,
    );
    let got: string;
    let args = '';
    try {
      const result = await model.complete(messages, ASSISTANT_TOOLS);
      const call = result.toolCalls[0];
      args = call ? `${call.name} ${call.arguments}` : '(도구 없음)';
      got = summarize(decide(result), context);
    } catch (error) {
      got = `오류 ${error instanceof Error ? error.name : 'unknown'}`;
    }
    const ok = got === expected || accept.includes(got);
    if (!ok) failed += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${text}\n      기대 ${expected}\n      결과 ${got}${ok ? '' : `\n      인자 ${args}`}`,
    );
  }
  console.log(`\n${cases.length - failed}/${cases.length} 통과`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
