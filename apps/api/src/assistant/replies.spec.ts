import { clarifyReply, eventDraftReply, eventDraftsReply, hm, HISTORY_MAX, longDate, periodLabel, shortDate, unsupportedLink, unsupportedReply } from './replies.js';

const draft = (startsAt: string, endsAt: string, allDay = false) => ({
  title: '워크숍',
  startsAt,
  endsAt,
  allDay,
  place: null,
  participants: [],
  members: [],
});

describe('문구 틀 (설계 4-3, 4-4)', () => {
  it('날짜 글자 (KST)', () => {
    expect(shortDate('2026-11-21')).toBe('11-21(토)');
    expect(longDate('2027-03-04')).toBe('3월 4일 (목)');
    expect(hm(new Date('2026-11-16T15:30:00Z'))).toBe('00:30');
  });

  it('기간 말: 이번 주, 다음 주, 이번 달, 다음 달, 오늘, 내일, 하루, 그 밖', () => {
    const today = '2026-11-16';
    expect(periodLabel('2026-11-15', '2026-11-21', today)).toBe('이번 주');
    expect(periodLabel('2026-11-22', '2026-11-28', today)).toBe('다음 주');
    expect(periodLabel('2026-11-01', '2026-11-30', today)).toBe('이번 달');
    expect(periodLabel('2026-12-01', '2026-12-31', today)).toBe('다음 달');
    expect(periodLabel('2026-11-16', '2026-11-16', today)).toBe('오늘');
    expect(periodLabel('2026-11-17', '2026-11-17', today)).toBe('내일');
    expect(periodLabel('2026-11-20', '2026-11-20', today)).toBe('11월 20일');
    expect(periodLabel('2026-11-20', '2026-11-30', today)).toBe('11월 20일 ~ 11월 30일');
  });

  it('일정 초안 historyText: 종일 하루, 종일 여러 날, 밤샘, 자정까지', () => {
    expect(eventDraftReply(draft('2026-11-29T15:00:00.000Z', '2026-11-30T15:00:00.000Z', true)).historyText).toBe('[일정 초안] 워크숍, 2026-11-30(월) 하루 종일');
    expect(eventDraftReply(draft('2026-11-29T15:00:00.000Z', '2026-12-01T15:00:00.000Z', true)).historyText).toBe('[일정 초안] 워크숍, 2026-11-30(월)~2026-12-01(화) 하루 종일');
    expect(eventDraftReply(draft('2026-11-27T13:00:00.000Z', '2026-11-27T17:00:00.000Z')).historyText).toBe('[일정 초안] 워크숍, 2026-11-27(금) 22:00~2026-11-28(토) 02:00');
    expect(eventDraftReply(draft('2026-11-27T13:00:00.000Z', '2026-11-27T15:00:00.000Z')).historyText).toBe('[일정 초안] 워크숍, 2026-11-27(금) 22:00~24:00');
  });

  it('historyText 는 600자 이하, 되묻기의 사람 이름은 20자', () => {
    const long = eventDraftReply({ ...draft('2026-11-27T10:00:00.000Z', '2026-11-27T11:00:00.000Z'), place: { text: '가'.repeat(100) }, title: '나'.repeat(50) });
    expect(long.historyText.length).toBeLessThanOrEqual(HISTORY_MAX);
    expect(clarifyReply('participant', { name: '가'.repeat(30) }).reply).toBe(`'${'가'.repeat(20)}'님을 이 팀에서 찾지 못했어요. 누구를 말하는지 알려 주세요`);
    expect(clarifyReply('which')).toMatchObject({ reply: '어떤 일정을 말하는지 알려 주세요', cards: [{ type: 'clarify', field: 'which', choices: [] }] });
  });

  it('(#474) 일정 초안 여러 개: 문구, 카드 일정마다, 기록은 " / " 로 잇고 600자 이하', () => {
    const one = draft('2026-11-27T10:00:00.000Z', '2026-11-27T11:00:00.000Z');
    const two = { ...draft('2026-11-28T05:00:00.000Z', '2026-11-28T06:00:00.000Z'), title: '영화' };
    expect(eventDraftsReply([one])).toEqual(eventDraftReply(one));
    expect(eventDraftsReply([one])).toMatchObject({ reply: '이렇게 넣을까요?', cards: [{ type: 'eventDraft', draft: one }] });
    expect(eventDraftsReply([one, two])).toEqual({
      reply: '일정 2개를 이렇게 넣을까요?',
      cards: [
        { type: 'eventDraft', draft: one },
        { type: 'eventDraft', draft: two },
      ],
      historyText: '[일정 초안] 워크숍, 2026-11-27(금) 19:00~20:00 / [일정 초안] 영화, 2026-11-28(토) 14:00~15:00',
    });
    const long = { ...one, title: '나'.repeat(50), place: { text: '가'.repeat(100) } };
    const five = eventDraftsReply(Array(5).fill(long));
    expect(five.reply).toBe('일정 5개를 이렇게 넣을까요?');
    expect(five.cards).toHaveLength(5);
    expect(Array.from(five.historyText).length).toBeLessThanOrEqual(HISTORY_MAX);
    expect(five.historyText.startsWith(`[일정 초안] ${'나'.repeat(50)}`)).toBe(true);
  });

  it('(#474) 되묻기에 일정 이름 머리말 (받침에 따라 은/는, 20자)', () => {
    expect(clarifyReply('date', { subject: '영화' }).reply).toBe("'영화'는 언제로 할까요?");
    expect(clarifyReply('time', { subject: '회식' })).toMatchObject({ reply: "'회식'은 몇 시로 할까요?", historyText: "[되물음] '회식'은 몇 시로 할까요?" });
    expect(clarifyReply('date', { subject: '가'.repeat(30) }).reply).toBe(`'${'가'.repeat(20)}'는 언제로 할까요?`);
    expect(clarifyReply('date', { subject: '' }).reply).toBe('언제로 할까요?');
  });

  it('못 하는 일 링크', () => {
    expect(unsupportedLink('repeat')).toEqual({ label: '일정 추가', href: '/events/new' });
    expect(unsupportedLink('reminder')?.href).toBe('/events/new');
    expect(unsupportedLink('anniversary_create')?.href).toBe('/anniversaries');
    expect(unsupportedLink('todo')?.href).toBe('/todos');
    expect(unsupportedLink('team')?.href).toBe('/team');
    expect(unsupportedLink('other_team')).toBeNull();
    expect(unsupportedLink('team_only')).toBeNull();
    expect(unsupportedLink('other')).toBeNull();
    expect(unsupportedReply('other_team')).toMatchObject({ reply: '볼까는 지금 보는 팀 일정만 알아요. 팀을 바꾸고 물어봐 주세요', historyText: '[안내] 다른 팀은 못 봄' });
  });
});
