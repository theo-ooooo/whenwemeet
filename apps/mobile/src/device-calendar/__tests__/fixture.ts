// (#549) 테스트용 스냅샷 일정
import type { CalendarEvent } from "../snapshot";

export const WEB = "https://whenwemeet.day";
export const GENERATED = "2026-11-26T03:00:00.000Z";

export const timed = (id: number, over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    uid: `e${id}@whenwemeet.day`,
    title: `일정 ${id}`,
    allDay: false,
    start: "2026-11-27T10:00:00.000Z",
    end: "2026-11-27T11:00:00.000Z",
    url: `${WEB}/events/abc${id}?team=team1xxx`,
    ...over,
  }) as CalendarEvent;

export const allDay = (id: number, start: string, end: string, over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ uid: `e${id}@whenwemeet.day`, title: `종일 ${id}`, allDay: true, start, end, ...over }) as CalendarEvent;
