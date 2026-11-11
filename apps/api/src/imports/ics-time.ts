/**
 * (#279) ICS 시각 → UTC 순간 (설계 `일정-가져오기.md` 3-2, D-158).
 * IANA 이름은 `Intl` 로, 아니면 파일의 VTIMEZONE 으로, 둘 다 안 되면 KST 로 보고 UNKNOWN_TZID 경고.
 * 시간대 없는 떠 있는 시각은 KST (MVP 5장). 순수 함수 (ical.js 의 Timezone 만 받는다)
 */
import ICAL from 'ical.js';
import { KST_OFFSET_MS } from '../events/recurrence.js';

/** 벽시계 시각 (월은 1부터) */
export interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** 시각이 어느 시간대 기준인지. `zone` 은 IANA 이름 또는 VTIMEZONE 하나 */
export type Zone =
  | { type: 'UTC' }
  | { type: 'KST' }
  | { type: 'IANA'; name: string }
  | { type: 'VTIMEZONE'; tz: ICAL.Timezone; fixed: boolean };

/** Windows 시간대 이름 중 아웃룩 내보내기에 흔한 것만 (나머지는 VTIMEZONE 이 있으면 그걸 쓴다) */
const WINDOWS_ZONES: Record<string, string> = {
  'Korea Standard Time': 'Asia/Seoul',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'China Standard Time': 'Asia/Shanghai',
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Eastern Standard Time': 'America/New_York',
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(name: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(name);
  if (cached) return cached;
  try {
    const created = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(name, created);
    return created;
  } catch {
    return null;
  }
}

/**
 * TZID 를 IANA 이름으로. 그대로 되면 그 이름, `/mozilla.org/20050126_1/Asia/Seoul` 처럼 앞에 접두사가 붙었으면 뒤의 `대륙/도시`,
 * Windows 이름 몇 개는 표로. 모르면 null
 */
export function ianaName(tzid: string): string | null {
  const trimmed = tzid.trim().replace(/^"|"$/g, '');
  if (formatter(trimmed)) return trimmed;
  const tail = /([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(trimmed)?.[1];
  if (tail && formatter(tail)) return tail;
  const windows = WINDOWS_ZONES[trimmed];
  return windows && formatter(windows) ? windows : null;
}

/** 그 순간 그 시간대의 UTC 와의 차이(ms) */
function ianaOffsetMs(name: string, instantMs: number): number {
  const parts = formatter(name)!.formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

const wallAsUtcMs = (wall: Wall) => Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s);

/**
 * 벽시계 → UTC 순간. 서머타임으로 없는 시각(봄의 빈 한 시간)은 앞으로 밀고, 두 번 있는 시각(가을)은 앞의 것.
 * VTIMEZONE 은 ical.js 의 utcOffset 으로
 */
export function toInstant(wall: Wall, zone: Zone): Date {
  const local = wallAsUtcMs(wall);
  switch (zone.type) {
    case 'UTC':
      return new Date(local);
    case 'KST':
      return new Date(local - KST_OFFSET_MS);
    case 'IANA': {
      const first = local - ianaOffsetMs(zone.name, local);
      const second = local - ianaOffsetMs(zone.name, first);
      const valid = [first, second].filter((instant) => instant + ianaOffsetMs(zone.name, instant) === local);
      // 두 번 있는 시각은 앞의 것, 없는 시각은 바뀌기 전 오프셋으로 읽은 쪽 (RFC 5545 3.3.5)
      return new Date(valid.length > 0 ? Math.min(...valid) : Math.max(first, second));
    }
    case 'VTIMEZONE': {
      const time = ICAL.Time.fromData({ year: wall.y, month: wall.mo, day: wall.d, hour: wall.h, minute: wall.mi, second: wall.s, isDate: false });
      return new Date(local - zone.tz.utcOffset(time) * 1000);
    }
  }
}

/**
 * 오프셋이 늘 같은 시간대인지 (서머타임 없음). 반복을 우리 규칙(KST 벽시계 고정)으로 옮겨도 되는지 판정한다 (D-159).
 * IANA 는 시작 해부터 3년의 1월, 7월 오프셋이 모두 같으면 고정으로 본다
 */
export function isFixedOffset(zone: Zone, year: number): boolean {
  switch (zone.type) {
    case 'UTC':
    case 'KST':
      return true;
    case 'VTIMEZONE':
      return zone.fixed;
    case 'IANA': {
      const offsets = new Set<number>();
      for (let y = year; y < year + 3; y += 1) {
        offsets.add(ianaOffsetMs(zone.name, Date.UTC(y, 0, 15)));
        offsets.add(ianaOffsetMs(zone.name, Date.UTC(y, 6, 15)));
      }
      return offsets.size === 1;
    }
  }
}
