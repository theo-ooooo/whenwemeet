/**
 * (#458) 볼까 실제 모델 확인 스크립트 (선택, CI 에서 돌리지 않음. 설계 AI-비서.md 5-2).
 * 운영과 같은 지시문, 도구, 가드, 정규화로 실제 OpenAI 모델에 날짜, 참여자 문장을 보내고 서버가 정한 날짜를 기대값과 비교한다.
 * 기준 시각은 운영 재현 날 2026-11-16 (월) 14:05 KST 로 고정한다(모델에도 그 날을 오늘로 준다). 팀은 "경"(나), "김수경".
 *
 * 실행 (apps/api 에서, 키는 환경 변수로만. 이 스크립트는 키를 출력하지 않는다):
 *   OPENAI_API_KEY=... pnpm dlx tsx@4 scripts/assistant-live-eval.ts
 *   OPENAI_MODEL=gpt-4o-mini 처럼 (기본 gpt-4.1-mini) 모델을 바꿀 수 있다
 * 하나라도 틀리면 종료 코드 1. 문장 하나당 모델 호출 1번 (약 22번)
 */
import { OpenAiAssistantModel } from '../src/assistant/openai-model.js';
import { DEFAULT_OPENAI_MODEL } from '../src/assistant/assistant-model.js';
import { decide } from '../src/assistant/guard.js';
import {
  NormalizeProblem,
  normalizeDraftEvent,
  normalizeFindAnniversary,
  normalizeFreeTime,
  normalizeListEvents,
  type DraftEventArgs,
  type FindAnniversaryArgs,
  type FindFreeTimeArgs,
  type ListEventsArgs,
  type NormalizeContext,
} from '../src/assistant/normalize.js';
import { buildMessages } from '../src/assistant/prompt.js';
import { ASSISTANT_TOOLS } from '../src/assistant/tools.js';

/** 2026-11-16 (월) 14:05 KST */
const NOW = new Date('2026-11-16T05:05:00.000Z');
const TEAM = [
  { userId: 1, name: '경' },
  { userId: 2, name: '김수경' },
];

interface Case {
  text: string;
  /** 기대 결과를 한 줄 글자로 (아래 summarize 와 같은 모양) */
  expected: string;
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
        const card = normalizeDraftEvent(
          outcome.args as unknown as DraftEventArgs,
          context,
        );
        const start = kst(card.startsAt);
        return `event ${start.date} ${card.allDay ? '종일' : start.time} ${nameOf(card.participants)}`;
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

  let failed = 0;
  for (const { text, expected } of CASES) {
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
    const ok = got === expected;
    if (!ok) failed += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${text}\n      기대 ${expected}\n      결과 ${got}${ok ? '' : `\n      인자 ${args}`}`,
    );
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} 통과`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
