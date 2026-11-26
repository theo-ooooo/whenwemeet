// 팀 달력의 생일과 기념일 (#491)
import { parseId } from "@/lib/id";
import { hasLeapMonth, isLunarDate } from "@/lib/lunar";
import { memberOf } from "../fixtures";
import { errorBody } from "@/lib/envelope";
import { err, nextId, nowIso, ok, type GroupReq, type MockResult } from "./shared";

  // (#305) 이 팀 달력에 보이는 멤버 생일 (가입순). 생일이 있고 그 팀 showBirthday 가 켜진 멤버만
export function birthdaysRoute(req: GroupReq): MockResult | null {
  const { s, method, groupId, rest } = req;
  if (rest[0] === "birthdays" && rest.length === 1 && method === "GET") {
    const rows = s.memberships
      .filter((m) => m.groupId === groupId && m.showBirthday !== false)
      .map((m) => ({ m, u: s.users.find((x) => x.id === m.userId) }))
      .filter((r) => r.u?.birthday)
      .sort((a, b) => a.m.joinedAt.localeCompare(b.m.joinedAt));
    // (#562) 음력 생일은 달력 종류와 윤달을 함께
    return ok(
      rows.map((r) => ({
        member: memberOf(s, groupId, r.m.userId),
        date: r.u!.birthday!,
        calendar: r.u!.birthdayCalendar ?? "SOLAR",
        isLeapMonth: r.u!.birthdayLeapMonth ?? false,
      })),
    );
  }
  return null;
}

export function anniversaryRoutes(req: GroupReq): MockResult | null {
  const { s, method, body, userId, groupId, rest } = req;
  if (rest[0] === "anniversaries") {
    const out = (a: (typeof s.anniversaries)[number]) => ({
      id: a.id,
      groupId: a.groupId,
      name: a.name,
      date: a.date,
      kind: a.kind,
      calendar: a.calendar ?? "SOLAR",
      isLeapMonth: a.isLeapMonth ?? false,
      reminders: a.reminders ?? ["DAY_OF"],
      creator: memberOf(s, groupId, a.creatorId),
      createdAt: a.createdAt,
    });
    const KINDS = ["COUNT_UP", "YEARLY", "ONCE"] as const;
    // (#269) 알림 시점: API 와 같은 규칙 (배열, 셋 중, 중복 없음). 응답은 당일, 하루 전, 일주일 전 순
    const REMINDERS = ["DAY_OF", "DAY_BEFORE", "WEEK_BEFORE"] as const;
    type Reminder = (typeof REMINDERS)[number];
    const remindersOk = (v: unknown) =>
      v === undefined ||
      (Array.isArray(v) && v.every((r) => REMINDERS.includes(r as Reminder)) && new Set(v).size === v.length);
    const orderReminders = (v: unknown) => REMINDERS.filter((r) => (v as Reminder[]).includes(r));
    const validate = (name: unknown, date: unknown, partial: boolean, kind?: unknown, reminders?: unknown): MockResult | null => {
      if (kind !== undefined && !KINDS.includes(kind as (typeof KINDS)[number])) {
        return err(400, "VALIDATION_FAILED", `종류는 ${KINDS.join(", ")} 중 하나여야 해요`);
      }
      if (!remindersOk(reminders)) {
        return err(400, "VALIDATION_FAILED", `알림은 ${REMINDERS.join(", ")} 중에서 골라야 해요`);
      }
      if (!partial || name !== undefined) {
        const n = typeof name === "string" ? name.trim() : "";
        if (n.length < 1 || n.length > 30) return err(400, "VALIDATION_FAILED", "이름은 1~30자로 입력해 주세요");
      }
      if (!partial || date !== undefined) {
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return err(400, "VALIDATION_FAILED", "날짜를 확인해 주세요");
        }
      }
      return null;
    };
    // (#562) 서버 assertAnniversaryDate 와 같은 짝 검사 (음력은 그 해에 있는 날짜, 윤달은 그 해에 있을 때만)
    const checkCalendar = (date: string, calendar: unknown, leap: unknown): MockResult | null => {
      const bad = (field: string, message: string): MockResult => ({ status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field, message }]) });
      if (calendar !== "SOLAR" && calendar !== "LUNAR") return bad("calendar", "달력은 SOLAR, LUNAR 중 하나여야 해요");
      if (typeof leap !== "boolean") return bad("isLeapMonth", "윤달은 true 나 false 여야 해요");
      if (calendar === "SOLAR") return leap ? bad("isLeapMonth", "윤달은 음력 날짜에만 고를 수 있어요") : null;
      const [year, month, day] = date.split("-").map(Number);
      if (isLunarDate({ year, month, day, leap })) return null;
      if (leap && !hasLeapMonth(year, month)) return bad("isLeapMonth", "그 해에는 그 달의 윤달이 없어요");
      return bad("date", "그 해 음력에 없는 날짜예요");
    };
    if (rest.length === 1 && method === "GET") {
      return ok(
        s.anniversaries
          .filter((a) => a.groupId === groupId)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(out),
      );
    }
    if (rest.length === 1 && method === "POST") {
      const v = validate(body?.name, body?.date, false, body?.kind, body?.reminders);
      if (v) return v;
      const calendar = (body?.calendar ?? "SOLAR") as "SOLAR" | "LUNAR";
      const isLeapMonth = (body?.isLeapMonth ?? false) as boolean;
      const c = checkCalendar(String(body!.date), calendar, isLeapMonth);
      if (c) return c;
      const row = {
        id: nextId(),
        groupId,
        name: String(body!.name).trim(),
        date: String(body!.date),
        kind: (body?.kind ?? "COUNT_UP") as (typeof KINDS)[number],
        calendar,
        isLeapMonth,
        reminders: body?.reminders === undefined ? (["DAY_OF"] as Reminder[]) : orderReminders(body.reminders),
        creatorId: userId,
        createdAt: nowIso(),
      };
      s.anniversaries.push(row);
      return ok(out(row), 201);
    }
    const anniversaryId = parseId(rest[1]);
    if (anniversaryId === null) return err(400, "VALIDATION_FAILED", "anniversaryId 은(는) 양의 정수여야 해요");
    const a = s.anniversaries.find((x) => x.id === anniversaryId && x.groupId === groupId);
    if (!a) return err(404, "NOT_FOUND", "기념일을 찾을 수 없어요");
    if (method === "PATCH") {
      const v = validate(body?.name, body?.date, true, body?.kind, body?.reminders);
      if (v) return v;
      // (#562) 날짜, 달력, 윤달 중 하나라도 오면 합친 값으로 다시 본다. 양력으로 바꾸면 윤달은 끈다
      if (body?.date !== undefined || body?.calendar !== undefined || body?.isLeapMonth !== undefined) {
        const calendar = (body?.calendar ?? a.calendar ?? "SOLAR") as "SOLAR" | "LUNAR";
        const isLeapMonth = calendar === "SOLAR" && body?.isLeapMonth === undefined ? false : ((body?.isLeapMonth ?? a.isLeapMonth ?? false) as boolean);
        const c = checkCalendar(String(body?.date ?? a.date), calendar, isLeapMonth);
        if (c) return c;
        a.calendar = calendar;
        a.isLeapMonth = isLeapMonth;
      }
      if (body?.name !== undefined) a.name = String(body.name).trim();
      if (body?.date !== undefined) a.date = String(body.date);
      if (body?.kind !== undefined) a.kind = body.kind as (typeof KINDS)[number];
      if (body?.reminders !== undefined) a.reminders = orderReminders(body.reminders);
      return ok(out(a));
    }
    if (method === "DELETE") {
      s.anniversaries = s.anniversaries.filter((x) => x.id !== a.id);
      return ok({ ok: true });
    }
  }
  return null;
}
