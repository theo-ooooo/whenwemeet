/**
 * (#279) ICS 파일 → VEVENT 목록 (설계 `일정-가져오기.md` 3-1). ical.js 로 읽고(접힌 줄, 이스케이프, 매개변수)
 * 시각은 `ics-time.ts` 로 UTC 순간이 된다. VTODO, VJOURNAL, VALARM, ATTENDEE, 첨부는 읽지 않는다. 순수 함수
 */
import ICAL from 'ical.js';
import { ApiException } from '../common/errors.js';
import { ianaName, isFixedOffset, toInstant, type Wall, type Zone } from './ics-time.js';

/** 파일 크기 상한 2MB (기획 3장) */
export const ICS_MAX_BYTES = 2 * 1024 * 1024;
/** VEVENT 수 상한 */
export const ICS_MAX_VEVENTS = 3000;

export const ICS_READ_FAILED_MESSAGE = '캘린더 파일(.ics)을 읽지 못했어요';

/** 시각 하나. 종일이면 `date` ('YYYY-MM-DD'), 아니면 벽시계 + 시간대 */
export type IcsTime = { allDay: true; date: string; wall: Wall } | { allDay: false; wall: Wall; zone: Zone };

/** RRULE 중 우리가 보는 것 */
export interface IcsRule {
  freq: string;
  interval: number;
  count: number | null;
  /** UNTIL 순간. 종일이면 그날 KST 끝(다음 날 00:00 직전)으로 본다 */
  until: Date | null;
  /** BYDAY, BYMONTHDAY 등 BY 부분. 키는 대문자 */
  parts: Record<string, (string | number)[]>;
  /** BY 부분을 펼치는 데 쓰는 ical.js 규칙 (UNTIL, COUNT 는 비운 사본) */
  recur: ICAL.Recur;
}

export interface IcsEvent {
  uid: string | null;
  summary: string;
  description: string;
  location: string;
  status: string | null;
  start: IcsTime;
  /** DTEND 를 바로 읽은 값. 없으면 null (DURATION 또는 기본 길이) */
  end: IcsTime | null;
  /** DURATION 초. 종일 DURATION 은 일 수 × 하루 */
  durationSec: number | null;
  /** RRULE 이 정확히 하나일 때만. 둘 이상이거나 못 읽으면 `ruleUnsupported` */
  rule: IcsRule | null;
  ruleUnsupported: boolean;
  /** RDATE 값 (있으면 반복을 옮기지 않고 펼친다) */
  rdates: IcsTime[];
  exdates: IcsTime[];
  recurrenceId: IcsTime | null;
  /** 모르는 TZID 를 KST 로 본 시각이 있는지 */
  unknownTzid: boolean;
}

export interface ParsedCalendar {
  events: IcsEvent[];
  /** 파일 안 VEVENT 수 */
  veventCount: number;
}

const readFailed = (message = ICS_READ_FAILED_MESSAGE) => new ApiException('VALIDATION_FAILED', message, [{ field: 'file', message }]);

/**
 * 접힌 줄(줄바꿈 + 공백 또는 탭)을 바이트 단계에서 잇는다. 75 옥텟마다 접으며 한글(UTF-8 3바이트) 중간을 자르는 내보내기가 있어
 * 글자로 디코딩한 뒤에 이으면 깨진다 (RFC 5545 3.1). latin1 은 바이트와 1:1 이라 정규식을 그대로 쓸 수 있다
 */
export function unfoldBytes(bytes: Buffer): Buffer {
  return Buffer.from(bytes.toString('latin1').replace(/\r?\n[ \t]/g, ''), 'latin1');
}

/** ICS 파일을 읽는다. 못 읽으면 400 VALIDATION_FAILED(file), VEVENT 가 3,000 개를 넘으면 400 IMPORT_TOO_LARGE */
export function parseIcs(bytes: Buffer): ParsedCalendar {
  if (bytes.length === 0) throw readFailed();
  if (bytes.length > ICS_MAX_BYTES) throw readFailed('파일이 너무 커요. 2MB 까지 올릴 수 있어요');
  const text = unfoldBytes(bytes).toString('utf8').replace(/^﻿/, '');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw readFailed();

  let root: ICAL.Component;
  try {
    const parsed: unknown = ICAL.parse(text);
    // 한 파일에 VCALENDAR 가 여럿이면 배열. 첫 것만 (구글, 애플, 네이버 모두 하나)
    const jcal = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed[0] : parsed;
    root = new ICAL.Component(jcal as unknown[]);
  } catch {
    throw readFailed();
  }
  if (root.name !== 'vcalendar') throw readFailed();

  const vevents = root.getAllSubcomponents('vevent');
  if (vevents.length > ICS_MAX_VEVENTS) {
    throw new ApiException('IMPORT_TOO_LARGE', `일정이 너무 많아요. 한 파일에 ${ICS_MAX_VEVENTS.toLocaleString('en-US')}개까지 읽을 수 있어요`);
  }
  const zones = new ZoneResolver(root);
  const events: IcsEvent[] = [];
  for (const vevent of vevents) {
    const event = readEvent(vevent, zones);
    if (event) events.push(event);
  }
  return { events, veventCount: vevents.length };
}

/** TZID → Zone. 파일의 VTIMEZONE 은 IANA 로 못 읽을 때만 쓴다 */
class ZoneResolver {
  private readonly vtimezones = new Map<string, ICAL.Component>();
  private readonly cache = new Map<string, Zone | null>();

  constructor(root: ICAL.Component) {
    for (const vtimezone of root.getAllSubcomponents('vtimezone')) {
      const tzid = vtimezone.getFirstPropertyValue('tzid');
      if (typeof tzid === 'string') this.vtimezones.set(tzid, vtimezone);
    }
  }

  /** 모르면 null (호출자가 KST 로 보고 경고) */
  resolve(tzid: string): Zone | null {
    if (this.cache.has(tzid)) return this.cache.get(tzid)!;
    let zone: Zone | null = null;
    const iana = ianaName(tzid);
    if (iana === 'UTC' || iana === 'Etc/UTC') zone = { type: 'UTC' };
    else if (iana) zone = { type: 'IANA', name: iana };
    else {
      const component = this.vtimezones.get(tzid);
      if (component) {
        try {
          zone = { type: 'VTIMEZONE', tz: new ICAL.Timezone(component), fixed: component.getAllSubcomponents('daylight').length === 0 };
        } catch {
          zone = null;
        }
      }
    }
    this.cache.set(tzid, zone);
    return zone;
  }
}

function text(vevent: ICAL.Component, name: string): string {
  const value = vevent.getFirstPropertyValue(name);
  return typeof value === 'string' ? value : '';
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** ical.js Time + 그 속성의 TZID → IcsTime. 모르는 TZID 면 KST 로 보고 unknown 표시 */
function toIcsTime(time: ICAL.Time, tzid: string | null, zones: ZoneResolver, flags: { unknownTzid: boolean }): IcsTime {
  const wall: Wall = { y: time.year, mo: time.month, d: time.day, h: time.hour, mi: time.minute, s: time.second };
  if (time.isDate) return { allDay: true, date: `${pad(wall.y, 4)}-${pad(wall.mo)}-${pad(wall.d)}`, wall };
  if (time.zone?.tzid === 'UTC') return { allDay: false, wall, zone: { type: 'UTC' } };
  if (!tzid) return { allDay: false, wall, zone: { type: 'KST' } };
  const zone = zones.resolve(tzid);
  if (!zone) {
    flags.unknownTzid = true;
    return { allDay: false, wall, zone: { type: 'KST' } };
  }
  return { allDay: false, wall, zone };
}

function propertyTime(vevent: ICAL.Component, name: string, zones: ZoneResolver, flags: { unknownTzid: boolean }): IcsTime | null {
  const property = vevent.getFirstProperty(name);
  if (!property) return null;
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time)) return null;
  return toIcsTime(value, paramString(property.getParameter('tzid')), zones, flags);
}

function paramString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function propertyTimes(vevent: ICAL.Component, name: string, zones: ZoneResolver, flags: { unknownTzid: boolean }): IcsTime[] {
  const result: IcsTime[] = [];
  for (const property of vevent.getAllProperties(name)) {
    const tzid = paramString(property.getParameter('tzid'));
    for (const value of property.getValues()) {
      if (value instanceof ICAL.Time) result.push(toIcsTime(value, tzid, zones, flags));
    }
  }
  return result;
}

/** IcsTime → UTC 순간. 종일은 그날 KST 00:00 (D-16) */
export function instantOf(time: IcsTime): Date {
  if (time.allDay) return toInstant(time.wall, { type: 'KST' });
  return toInstant(time.wall, time.zone);
}

/** 반복을 KST 벽시계 고정 규칙으로 옮겨도 되는 시각인지 (종일, 떠 있는 시각, UTC, 서머타임 없는 시간대) */
export function hasFixedOffset(time: IcsTime): boolean {
  return time.allDay || isFixedOffset(time.zone, time.wall.y);
}

function readRule(vevent: ICAL.Component, start: IcsTime, zones: ZoneResolver, flags: { unknownTzid: boolean }): { rule: IcsRule | null; unsupported: boolean } {
  const properties = vevent.getAllProperties('rrule');
  if (properties.length === 0) return { rule: null, unsupported: false };
  const value = properties[0].getFirstValue();
  if (properties.length > 1 || !(value instanceof ICAL.Recur)) return { rule: null, unsupported: true };
  let until: Date | null = null;
  if (value.until) {
    const untilTime = toIcsTime(value.until, null, zones, flags);
    // UNTIL 이 날짜면 그날 끝까지 포함. 시간대 없는 UNTIL 은 DTSTART 와 같은 시간대로 본다 (RFC 5545 3.3.10)
    if (untilTime.allDay) until = new Date(instantOf(untilTime).getTime() + 24 * 60 * 60 * 1000 - 1);
    else if (untilTime.zone.type === 'KST' && !start.allDay) until = instantOf({ ...untilTime, zone: start.zone });
    else until = instantOf(untilTime);
  }
  const recur = value.clone();
  recur.until = null;
  recur.count = null;
  const parts: Record<string, (string | number)[]> = {};
  for (const [key, list] of Object.entries(value.parts ?? {})) {
    if (Array.isArray(list) && list.length > 0) parts[key.toUpperCase()] = list as (string | number)[];
  }
  return {
    rule: { freq: String(value.freq ?? '').toUpperCase(), interval: value.interval || 1, count: value.count ?? null, until, parts, recur },
    unsupported: false,
  };
}

function durationSeconds(vevent: ICAL.Component): number | null {
  const value = vevent.getFirstPropertyValue('duration');
  if (!(value instanceof ICAL.Duration)) return null;
  const seconds = value.toSeconds();
  return Number.isFinite(seconds) ? seconds : null;
}

/** VEVENT 하나. DTSTART 가 없거나 못 읽으면 null 대신 INVALID 로 세도록 start 없는 표시를 남긴다 */
function readEvent(vevent: ICAL.Component, zones: ZoneResolver): IcsEvent | null {
  const flags = { unknownTzid: false };
  try {
    const start = propertyTime(vevent, 'dtstart', zones, flags);
    if (!start) return invalidEvent(vevent);
    const { rule, unsupported } = readRule(vevent, start, zones, flags);
    const uid = vevent.getFirstPropertyValue('uid');
    const status = vevent.getFirstPropertyValue('status');
    return {
      uid: typeof uid === 'string' && uid.trim() !== '' ? uid.trim() : null,
      summary: text(vevent, 'summary'),
      description: text(vevent, 'description'),
      location: text(vevent, 'location'),
      status: typeof status === 'string' ? status.toUpperCase() : null,
      start,
      end: propertyTime(vevent, 'dtend', zones, flags),
      durationSec: durationSeconds(vevent),
      rule,
      ruleUnsupported: unsupported,
      rdates: propertyTimes(vevent, 'rdate', zones, flags),
      exdates: propertyTimes(vevent, 'exdate', zones, flags),
      recurrenceId: propertyTime(vevent, 'recurrence-id', zones, flags),
      unknownTzid: flags.unknownTzid,
    };
  } catch {
    return invalidEvent(vevent);
  }
}

/** 시각을 읽지 못한 VEVENT. 계획 단계에서 INVALID 로 센다 */
export const INVALID_START: IcsTime = { allDay: true, date: '0000-00-00', wall: { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 } };

function invalidEvent(vevent: ICAL.Component): IcsEvent {
  const uid = vevent.getFirstPropertyValue('uid');
  return {
    uid: typeof uid === 'string' ? uid : null,
    summary: '',
    description: '',
    location: '',
    status: null,
    start: INVALID_START,
    end: null,
    durationSec: null,
    rule: null,
    ruleUnsupported: false,
    rdates: [],
    exdates: [],
    recurrenceId: null,
    unknownTzid: false,
  };
}
