// (#549) 휴대폰 캘린더 글루: expo-calendar(legacy API) 와 앱 문서 폴더 JSON (앱.md 4.9, D-294).
// 규칙과 순서는 sync.ts (jest 대상) 에 있고 여기는 기기 API 를 잇기만 한다.
import { Platform } from "react-native";
import * as Calendar from "expo-calendar/legacy";
import { File, Paths } from "expo-file-system";
import type { CalendarStatusReply } from "../bridge/reply";
import type { DeviceEventDetails } from "./plan";
import type { CalendarSnapshot } from "./snapshot";
import { CALENDAR_COLOR, CALENDAR_TITLE, type CalendarApi, DeviceCalendarSync, type StateFile } from "./sync";

/** 상태 파일 이름 (Paths.document 아래). 일정 내용은 없고 UID ↔ 기기 일정 id, 해시만 */
const STATE_FILE_NAME = "device-calendar.json";
/** Android 로컬 계정 이름 (캘린더 앱의 계정 목록에 이 이름으로 보인다) */
const ANDROID_ACCOUNT = "언제볼까";

const stateFile: StateFile = {
  read() {
    const f = new File(Paths.document, STATE_FILE_NAME);
    return f.exists ? f.textSync() : null;
  },
  write(text) {
    const f = new File(Paths.document, STATE_FILE_NAME);
    if (!f.exists) f.create();
    f.write(text);
  },
  remove() {
    const f = new File(Paths.document, STATE_FILE_NAME);
    if (f.exists) f.delete();
  },
};

/** iOS 새 캘린더의 출처: 기본 캘린더의 출처(대개 iCloud) → 기기 로컬 → 아무 CalDAV */
async function iosSourceId(): Promise<string> {
  try {
    const def = await Calendar.getDefaultCalendarAsync();
    if (def?.source?.id) return def.source.id;
  } catch {
    // 기본 캘린더가 없는 기기
  }
  const sources = await Calendar.getSourcesAsync();
  const pick = sources.find((s) => s.type === Calendar.SourceType.LOCAL) ?? sources.find((s) => s.type === Calendar.SourceType.CALDAV);
  if (!pick?.id) throw new Error("캘린더 출처 없음");
  return pick.id;
}

function toEventData(d: DeviceEventDetails) {
  return {
    title: d.title,
    startDate: d.startDate,
    endDate: d.endDate,
    allDay: d.allDay,
    location: d.location,
    notes: d.notes,
    ...(d.timeZone ? { timeZone: d.timeZone } : {}),
    ...(d.endTimeZone ? { endTimeZone: d.endTimeZone } : {}),
    ...(d.url ? { url: d.url } : {}),
    // 알림은 넣지 않는다 (언제볼까 푸시가 있다. ICS 도 VALARM 없음)
    alarms: [],
  };
}

const api: CalendarApi = {
  os: Platform.OS === "ios" ? "ios" : "android",
  async getPermission() {
    const p = await Calendar.getCalendarPermissionsAsync();
    return { status: p.status, canAskAgain: p.canAskAgain };
  },
  async requestPermission() {
    // iOS 17+ 는 전체 접근(NSCalendarsFullAccessUsageDescription). 쓰기 전용으로는 캘린더를 만들거나 우리 일정을 고칠 수 없다
    const p = await Calendar.requestCalendarPermissionsAsync();
    return { status: p.status, canAskAgain: p.canAskAgain };
  },
  async listOurCalendars() {
    const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return all
      .filter(
        (c) =>
          c.title === CALENDAR_TITLE &&
          c.allowsModifications !== false &&
          // Android 는 우리가 만든 로컬 계정 캘린더만 (구글 계정에 같은 이름 캘린더가 있어도 건드리지 않는다)
          (Platform.OS === "ios" || (c.source?.isLocalAccount === true && c.source?.name === ANDROID_ACCOUNT)),
      )
      .map((c) => ({ id: c.id }));
  },
  async createCalendar() {
    if (Platform.OS === "ios") {
      return Calendar.createCalendarAsync({
        title: CALENDAR_TITLE,
        color: CALENDAR_COLOR,
        entityType: Calendar.EntityTypes.EVENT,
        sourceId: await iosSourceId(),
      });
    }
    return Calendar.createCalendarAsync({
      title: CALENDAR_TITLE,
      name: "whenwemeet",
      color: CALENDAR_COLOR,
      entityType: Calendar.EntityTypes.EVENT,
      source: { isLocalAccount: true, name: ANDROID_ACCOUNT, type: "LOCAL" },
      ownerAccount: ANDROID_ACCOUNT,
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
      timeZone: "Asia/Seoul",
    });
  },
  deleteCalendar: (id) => Calendar.deleteCalendarAsync(id),
  async listEventIds(calendarId, from, to) {
    const events = await Calendar.getEventsAsync([calendarId], from, to);
    return events.map((e) => e.id);
  },
  createEvent: (calendarId, d) => Calendar.createEventAsync(calendarId, toEventData(d)),
  async updateEvent(id, d) {
    await Calendar.updateEventAsync(id, toEventData(d));
  },
  deleteEvent: (id) => Calendar.deleteEventAsync(id),
};

const service = new DeviceCalendarSync(api, stateFile);

export const calendarStatus = (id: string): Promise<CalendarStatusReply> => service.status(id);
export const enableDeviceCalendar = (id: string): Promise<CalendarStatusReply> => service.enable(id);
export const disableDeviceCalendar = (id: string): Promise<CalendarStatusReply | null> => service.disable(id);

/** 맞춘 뒤 id 가 있으면 상태를 돌려준다 */
export async function syncDeviceCalendar(snapshot: CalendarSnapshot, id?: string): Promise<CalendarStatusReply | null> {
  await service.sync(snapshot);
  return id ? service.status(id) : null;
}

/** (로그아웃, 탈퇴) 이전 사용자 일정이 휴대폰 캘린더에 남지 않게 우리 캘린더를 지운다. 켠 적이 없으면 아무것도 안 함 */
export function clearDeviceCalendar(): void {
  void service.clear().catch((e: unknown) => console.warn("[calendar] 지우기 실패", e));
}
