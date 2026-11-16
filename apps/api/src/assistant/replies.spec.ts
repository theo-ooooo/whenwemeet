import { clarifyReply, eventDraftReply, hm, HISTORY_MAX, longDate, periodLabel, shortDate, unsupportedLink, unsupportedReply } from './replies.js';

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

  it('못 하는 일 링크', () => {
    expect(unsupportedLink('edit_event', null)).toEqual({ label: '달력 열기', href: '/calendar' });
    expect(unsupportedLink('edit_event', '강남 회식')).toEqual({ label: '일정 찾기', href: '/search?q=%EA%B0%95%EB%82%A8%20%ED%9A%8C%EC%8B%9D' });
    expect(unsupportedLink('repeat', null)).toEqual({ label: '일정 추가', href: '/events/new' });
    expect(unsupportedLink('reminder', null)?.href).toBe('/events/new');
    expect(unsupportedLink('anniversary_create', null)?.href).toBe('/anniversaries');
    expect(unsupportedLink('todo', null)?.href).toBe('/todos');
    expect(unsupportedLink('team', null)?.href).toBe('/team');
    expect(unsupportedLink('other_team', null)).toBeNull();
    expect(unsupportedLink('team_only', null)).toBeNull();
    expect(unsupportedLink('other', null)).toBeNull();
    expect(unsupportedReply('other_team', null)).toMatchObject({ reply: '볼까는 지금 보는 팀 일정만 알아요. 팀을 바꾸고 물어봐 주세요', historyText: '[안내] 다른 팀은 못 봄' });
  });
});
