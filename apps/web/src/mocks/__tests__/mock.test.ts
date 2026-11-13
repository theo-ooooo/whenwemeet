import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getMockFile, MOCK_FILE_PREFIX, putMockFile } from "../files";
import { mockHandle } from "../handler";
import { FAMILY_ID, inviteMarkerOf, ME_ID, PERSONAL_ID, TEAM_ID } from "../fixtures";

const call = (method: string, path: string, body: Record<string, unknown> | null = null, query = "") =>
  mockHandle({ method, path, query: new URLSearchParams(query), body, userId: ME_ID }) as { status: number; body: { data: Record<string, unknown> } };

describe("목 파일 보관소 (data: URL 대신 http 경로)", () => {
  it("넣은 바이트를 경로로 다시 꺼낸다", () => {
    const url = putMockFile("image/png", new Uint8Array([1, 2, 3]));
    expect(url.startsWith(MOCK_FILE_PREFIX)).toBe(true);
    const got = getMockFile(url.slice(MOCK_FILE_PREFIX.length));
    expect(got?.type).toBe("image/png");
    expect(Array.from(got!.bytes)).toEqual([1, 2, 3]);
    expect(getMockFile("없음")).toBeNull();
  });

  it("POST /me/avatar 는 실제 API 처럼 경로를 profileImageUrl 로 준다", () => {
    const url = putMockFile("image/webp", new Uint8Array([9]));
    const r = call("POST", "/me/avatar", { file: { type: "image/webp", size: 1, url } });
    expect(r.status).toBe(200);
    expect(r.body.data.profileImageUrl).toBe(url);
    expect(String(r.body.data.profileImageUrl).startsWith("data:")).toBe(false);
  });
});

describe("목 free-slots 는 지금을 30분 올림 (#136)", () => {
  afterEach(() => vi.useRealTimers());

  it("13:07 이면 13:30 부터", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T04:07:00.000Z"));
    const r = call("GET", "/groups/1/free-slots", null, "from=2026-11-10T00:00:00%2B09:00&to=2026-11-11T00:00:00%2B09:00&dayStart=09:00&dayEnd=23:00&minMinutes=30");
    const slots = r.body.data.slots as { startsAt: string }[];
    expect(r.status).toBe(200);
    expect(slots.length).toBeGreaterThan(0);
    // 첫 구간은 지금(13:07)에서 잘린 것이라 13:30 이후, 30분 경계여야 한다 (13:07 이 아니라)
    expect(Date.parse(slots[0].startsAt)).toBeGreaterThanOrEqual(Date.parse("2026-11-10T04:30:00.000Z"));
    expect(slots.some((s) => s.startsAt === "2026-11-10T04:07:00.000Z")).toBe(false);
  });
});

describe("목 반복 일정 (#187)", () => {
  type Ev = { id: number; occurrence: string | null; startsAt: string; title: string; repeat: string | null; repeatUntil: string | null };
  const list = (from: string, to: string) =>
    (call("GET", "/groups/2/events", null, `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).body.data as unknown as Ev[]);
  const mine = (from: string, to: string, title: string) => list(from, to).filter((e) => e.title.startsWith(title));
  const F = "2027-03-01T00:00:00+09:00";
  const T = "2027-04-01T00:00:00+09:00";

  it("매주 일정은 회차로 펼치고, 이 일정만/이후 모두가 회차와 규칙을 바꾼다", () => {
    const created = call("POST", "/groups/2/events", {
      title: "반복테스트",
      startsAt: "2027-03-03T19:00:00+09:00",
      endsAt: "2027-03-03T21:00:00+09:00",
      allDay: false,
      repeat: "WEEKLY",
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as number;
    expect(created.body.data.occurrence).toBe("2027-03-03");
    expect(mine(F, T, "반복테스트").map((e) => e.occurrence)).toEqual(["2027-03-03", "2027-03-10", "2027-03-17", "2027-03-24", "2027-03-31"]);

    // scope 없으면 400
    expect(call("PATCH", `/groups/2/events/${id}`, { title: "x" }, "occurrence=2027-03-10").status).toBe(400);
    // 이 일정만: 그 회차만 20:00
    const one = call("PATCH", `/groups/2/events/${id}`, { startsAt: "2027-03-10T20:00:00+09:00", endsAt: "2027-03-10T22:00:00+09:00" }, "occurrence=2027-03-10&scope=this");
    expect(one.status).toBe(200);
    const got = call("GET", `/groups/2/events/${id}`, null, "occurrence=2027-03-03").body.data;
    expect(got.hasLaterExceptions).toBe(true);
    // 이 일정만 삭제
    expect(call("DELETE", `/groups/2/events/${id}`, null, "occurrence=2027-03-17&scope=this").status).toBe(200);
    expect(mine(F, T, "반복테스트").map((e) => e.occurrence)).toEqual(["2027-03-03", "2027-03-10", "2027-03-24", "2027-03-31"]);
    expect(call("GET", `/groups/2/events/${id}`, null, "occurrence=2027-03-17").status).toBe(404);

    // 이후 모두: 3-24 부터 제목 변경 → 원본은 3-23 까지, 새 원본
    const split = call("PATCH", `/groups/2/events/${id}`, { title: "반복테스트2" }, "occurrence=2027-03-24&scope=following");
    expect(split.status).toBe(200);
    expect(split.body.data.id).not.toBe(id);
    const after = mine(F, T, "반복테스트");
    expect(after.map((e) => [e.title, e.occurrence])).toEqual([
      ["반복테스트", "2027-03-03"],
      ["반복테스트", "2027-03-10"],
      ["반복테스트2", "2027-03-24"],
      ["반복테스트2", "2027-03-31"],
    ]);
    expect(after[0].repeatUntil).toBe("2027-03-23");

    // 이후 모두 삭제 (첫 회차면 전체)
    expect(call("DELETE", `/groups/2/events/${id}`, null, "occurrence=2027-03-03&scope=following").status).toBe(200);
    expect(mine(F, T, "반복테스트").map((e) => e.title)).toEqual(["반복테스트2", "반복테스트2"]);
  });

  it("이후 모두: 종료 날짜를 안 보내고 마지막 회차를 뒤로 옮기면 종료가 새 시작으로 늘어난다 (QA3-L1)", () => {
    const created = call("POST", "/groups/2/events", {
      title: "종료테스트",
      startsAt: "2027-04-07T19:00:00+09:00",
      endsAt: "2027-04-07T20:00:00+09:00",
      allDay: false,
      repeat: "WEEKLY",
      repeatUntil: "2027-04-14",
    });
    const id = created.body.data.id as number;
    const moved = call(
      "PATCH",
      `/groups/2/events/${id}`,
      { startsAt: "2027-04-16T19:00:00+09:00", endsAt: "2027-04-16T20:00:00+09:00", repeat: "WEEKLY" },
      "occurrence=2027-04-14&scope=following",
    );
    expect(moved.status).toBe(200);
    expect(moved.body.data.repeatUntil).toBe("2027-04-16");
    // 종료 날짜를 보냈으면 그대로 검증한다
    const again = call(
      "PATCH",
      `/groups/2/events/${moved.body.data.id}`,
      { startsAt: "2027-04-18T19:00:00+09:00", endsAt: "2027-04-18T20:00:00+09:00", repeatUntil: "2027-04-16" },
      "occurrence=2027-04-16&scope=following",
    );
    expect(again.status).toBe(400);
  });

  it("길이 >= 주기, 종료 < 시작이면 거부", () => {
    const base = { title: "x", startsAt: "2027-03-03T00:00:00+09:00", allDay: true };
    expect(call("POST", "/groups/2/events", { ...base, endsAt: "2027-03-11T00:00:00+09:00", repeat: "WEEKLY" }).status).toBe(400);
    expect(call("POST", "/groups/2/events", { ...base, endsAt: "2027-03-04T00:00:00+09:00", repeat: "WEEKLY", repeatUntil: "2027-03-02" }).status).toBe(400);
  });

  it("매월 31일은 짧은 달에 말일", () => {
    const r = call("POST", "/groups/2/events", {
      title: "월말테스트",
      startsAt: "2027-01-31T10:00:00+09:00",
      endsAt: "2027-01-31T11:00:00+09:00",
      allDay: false,
      repeat: "MONTHLY",
    });
    expect(r.status).toBe(201);
    expect(mine("2027-02-01T00:00:00+09:00", "2027-04-01T00:00:00+09:00", "월말테스트").map((e) => e.occurrence)).toEqual(["2027-02-28", "2027-03-31"]);
  });

  it("매월 31일을 2/28 회차에서 이후 모두로 제목만 바꿔도 3-31, 4-30 (반복 기준 날짜, QA3-M3)", () => {
    const r = call("POST", "/groups/2/events", {
      title: "기준테스트",
      startsAt: "2027-01-31T10:00:00+09:00",
      endsAt: "2027-01-31T11:00:00+09:00",
      allDay: false,
      repeat: "MONTHLY",
    });
    expect(r.body.data.repeatAnchor).toBeNull();
    const split = call("PATCH", `/groups/2/events/${r.body.data.id}`, { title: "기준테스트2", repeat: "MONTHLY" }, "occurrence=2027-02-28&scope=following");
    expect(split.status).toBe(200);
    expect(split.body.data).toMatchObject({ occurrence: "2027-02-28", repeatAnchor: "2027-01-31" });
    expect(mine("2027-03-01T00:00:00+09:00", "2027-05-01T00:00:00+09:00", "기준테스트2").map((e) => e.occurrence)).toEqual(["2027-03-31", "2027-04-30"]);
    // 날짜를 바꾸면 기준이 사라진다
    const moved = call(
      "PATCH",
      `/groups/2/events/${split.body.data.id}`,
      { startsAt: "2027-02-27T10:00:00+09:00", endsAt: "2027-02-27T11:00:00+09:00" },
      "occurrence=2027-02-28&scope=following",
    );
    expect(moved.body.data).toMatchObject({ occurrence: "2027-02-27", repeatAnchor: null });
  });

  it("옮긴 회차에서 이후 모두로 제목만 바꾸면 원래 요일에서 잇는다 (QA3-M3)", () => {
    const r = call("POST", "/groups/2/events", {
      title: "요일테스트",
      startsAt: "2027-05-05T19:00:00+09:00",
      endsAt: "2027-05-05T20:00:00+09:00",
      allDay: false,
      repeat: "WEEKLY",
    });
    const id = r.body.data.id as number;
    call("PATCH", `/groups/2/events/${id}`, { startsAt: "2027-05-14T19:00:00+09:00", endsAt: "2027-05-14T20:00:00+09:00" }, "occurrence=2027-05-12&scope=this");
    const split = call("PATCH", `/groups/2/events/${id}`, { title: "요일테스트2", repeat: "WEEKLY" }, "occurrence=2027-05-12&scope=following");
    expect(split.body.data).toMatchObject({ occurrence: "2027-05-12", repeatAnchor: null });
    expect(mine("2027-05-10T00:00:00+09:00", "2027-05-25T00:00:00+09:00", "요일테스트2").map((e) => e.occurrence)).toEqual(["2027-05-12", "2027-05-19"]);
  });
});

describe("목 푸시 알림 계약 (#188, 푸시-알림.md 7장)", () => {
  type Ev = { id: number; reminder: string; occurrence: string | null; allDay: boolean };
  const TOKEN = "ExponentPushToken[mockDevice1]";

  it("일정 reminder: 생략은 NONE, 종일과 맞지 않으면 400 field=reminder", () => {
    const base = { title: "알림테스트", startsAt: "2027-05-03T18:00:00+09:00", endsAt: "2027-05-03T19:00:00+09:00", allDay: false };
    const none = call("POST", "/groups/2/events", base);
    expect((none.body.data as unknown as Ev).reminder).toBe("NONE");
    const bad = call("POST", "/groups/2/events", { ...base, reminder: "DAY_OF_0900" }) as unknown as { status: number; body: { message: string; error: { details: { field: string }[] } } };
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("시간 일정에는 고를 수 없는 알림이에요");
    expect(bad.body.error.details[0].field).toBe("reminder");
    const created = call("POST", "/groups/2/events", { ...base, reminder: "HOUR_1" });
    const ev = created.body.data as unknown as Ev;
    expect(ev.reminder).toBe("HOUR_1");
    // 본문에 reminder 없이 종일로 바꾸면 맞지 않으니 NONE
    const toAllDay = call("PATCH", `/groups/2/events/${ev.id}`, { allDay: true, startsAt: "2027-05-03T00:00:00+09:00", endsAt: "2027-05-04T00:00:00+09:00" });
    expect((toAllDay.body.data as unknown as Ev).reminder).toBe("NONE");
    const pick = call("PATCH", `/groups/2/events/${ev.id}`, { reminder: "DAY_BEFORE_0900" });
    expect((pick.body.data as unknown as Ev).reminder).toBe("DAY_BEFORE_0900");
    expect((call("GET", `/groups/2/events/${ev.id}`).body.data as unknown as Ev).reminder).toBe("DAY_BEFORE_0900");
  });

  it("반복: 이 일정만은 그 회차만, 이후 모두는 새 원본에", () => {
    const created = call("POST", "/groups/2/events", {
      title: "반복알림",
      startsAt: "2027-06-02T19:00:00+09:00",
      endsAt: "2027-06-02T20:00:00+09:00",
      allDay: false,
      repeat: "WEEKLY",
      reminder: "MIN_10",
    });
    const id = (created.body.data as unknown as Ev).id;
    const get = (occ: string) => call("GET", `/groups/2/events/${id}`, null, `occurrence=${occ}`).body.data as unknown as Ev;
    call("PATCH", `/groups/2/events/${id}`, { reminder: "AT_START" }, "occurrence=2027-06-09&scope=this");
    expect(get("2027-06-09").reminder).toBe("AT_START");
    expect(get("2027-06-16").reminder).toBe("MIN_10");
    const following = call("PATCH", `/groups/2/events/${id}`, { reminder: "HOUR_1" }, "occurrence=2027-06-16&scope=following");
    const next = following.body.data as unknown as Ev;
    expect(next.id).not.toBe(id);
    expect(next.reminder).toBe("HOUR_1");
    expect(get("2027-06-02").reminder).toBe("MIN_10");
  });

  it("기기 등록/해제와 토큰 검증", () => {
    expect(call("PUT", "/me/push-devices", { token: TOKEN, platform: "IOS", appVersion: "1.1.0" }).status).toBe(200);
    expect(call("PUT", "/me/push-devices", { token: "fcm-raw", platform: "IOS", appVersion: "1.1.0" }).status).toBe(400);
    expect(call("PUT", "/me/push-devices", { token: TOKEN, platform: "WEB", appVersion: "1.1.0" }).status).toBe(400);
    expect(call("DELETE", "/me/push-devices", { token: TOKEN }).status).toBe(200);
    // 멱등
    expect(call("DELETE", "/me/push-devices", { token: TOKEN }).status).toBe(200);
  });

  it("처음 여는 달력 (#300): GET /me 기본 LAST, 짝과 권한 검사, 고정한 팀에서 나가면 LAST", () => {
    call("DELETE", "/me"); // 목 저장소 초기화
    expect(call("GET", "/me").body.data.startCalendar).toEqual({ mode: "LAST", groupId: null });
    expect(call("PATCH", "/me/start-calendar", { mode: "PERSONAL" }).body.data).toEqual({ mode: "PERSONAL", groupId: null });
    expect(call("PATCH", "/me/start-calendar", { mode: "GROUP", groupId: FAMILY_ID }).body.data).toEqual({ mode: "GROUP", groupId: FAMILY_ID });
    expect(call("GET", "/me").body.data.startCalendar).toEqual({ mode: "GROUP", groupId: FAMILY_ID });

    expect(call("PATCH", "/me/start-calendar", { mode: "GROUP" }).status).toBe(400);
    expect(call("PATCH", "/me/start-calendar", { mode: "LAST", groupId: TEAM_ID }).status).toBe(400);
    expect(call("PATCH", "/me/start-calendar", { mode: "GROUP", groupId: PERSONAL_ID }).status).toBe(400);
    expect(call("PATCH", "/me/start-calendar", { mode: "TEAM" }).status).toBe(400);
    expect(call("PATCH", "/me/start-calendar", { mode: "GROUP", groupId: 99999 }).status).toBe(403);

    // 다른 팀에서 나가면 그대로, 고정한 팀에서 나가면 LAST
    call("DELETE", `/groups/${TEAM_ID}/me`);
    expect(call("GET", "/me").body.data.startCalendar).toEqual({ mode: "GROUP", groupId: FAMILY_ID });
    call("DELETE", `/groups/${FAMILY_ID}/me`);
    expect(call("GET", "/me").body.data.startCalendar).toEqual({ mode: "LAST", groupId: null });
    call("DELETE", "/me");
  });

  it("알림 설정: 기본 모두 켬, 바꾼 키만, 불리언 아니면 400", () => {
    expect(call("GET", "/me/notification-settings").body.data).toEqual({ reminder: true, change: true, anniversary: true, join: true, weekly: true, weeklyNudge: false });
    expect(call("PATCH", "/me/notification-settings", { change: false }).body.data).toEqual({ reminder: true, change: false, anniversary: true, join: true, weekly: true, weeklyNudge: false });
    expect(call("PATCH", "/me/notification-settings", {}).body.data.change).toBe(false);
    expect(call("PATCH", "/me/notification-settings", { join: "no" }).status).toBe(400);
  });

  it("팀 알림: GroupDetail.me.notify, PATCH /groups/:id/me { notify }", () => {
    expect((call("GET", "/groups/2").body.data.me as { notify: boolean }).notify).toBe(true);
    const r = call("PATCH", "/groups/2/me", { notify: false });
    expect(r.body.data.notify).toBe(false);
    expect((call("GET", "/groups/2").body.data.me as { notify: boolean }).notify).toBe(false);
    // 다른 멤버에는 싣지 않는다
    expect((call("GET", "/groups/2").body.data.members as { notify?: boolean }[]).every((m) => m.notify === undefined)).toBe(true);
    expect(call("PATCH", "/groups/2/me", { notify: "off" }).status).toBe(400);
    call("PATCH", "/groups/2/me", { notify: true });
  });
});

describe("목 일정 참여자 (#248, 설계 3-2, 4장, 6장)", () => {
  type P = { all: boolean; members: { userId: number }[] };
  const ids = (p: P) => p.members.map((m) => m.userId);
  const as = (userId: number, method: string, path: string, body: Record<string, unknown> | null = null, query = "") =>
    mockHandle({ method, path, query: new URLSearchParams(query), body, userId }) as { status: number; body: { data: Record<string, unknown>; error?: { details?: { field: string }[] } } };
  const base = { title: "참여자테스트", startsAt: "2027-06-01T10:00:00+09:00", endsAt: "2027-06-01T12:00:00+09:00", allDay: false };

  it("생성: 생략 = [나], ALL = 지금 멤버 전원, 배열 = 가입순", () => {
    expect(ids(call("POST", "/groups/4/events", base).body.data.participants as P)).toEqual([ME_ID]);
    const all = call("POST", "/groups/4/events", { ...base, participants: "ALL" }).body.data.participants as P;
    expect(all.all).toBe(true);
    expect(ids(all)).toEqual([1, 3, 4, 2]);
    expect(ids(call("POST", "/groups/4/events", { ...base, participants: [2, 4, 4] }).body.data.participants as P)).toEqual([4, 2]);
  });

  it("검증: 빈 배열, 멤버 아님, 형식 오류는 400 field participants", () => {
    for (const participants of [[], [99], null, "SOME", ["1"]]) {
      const r = call("POST", "/groups/4/events", { ...base, participants }) as unknown as { status: number; body: { error: { details: { field: string }[] } } };
      expect(r.status).toBe(400);
      expect(r.body.error.details[0].field).toBe("participants");
    }
  });

  it("수정: 생략하면 그대로 (참여자 없음도), 주면 바뀐다", () => {
    const id = call("POST", "/groups/4/events", { ...base, participants: [3] }).body.data.id as number;
    expect(ids(call("PATCH", `/groups/4/events/${id}`, { title: "제목만" }).body.data.participants as P)).toEqual([3]);
    expect(ids(call("PATCH", `/groups/4/events/${id}`, { participants: [4] }).body.data.participants as P)).toEqual([4]);
  });

  it("반복: 이 일정만 + participants 는 400, 이후 모두는 새 원본에 (생략이면 원본 값 복사)", () => {
    const r = call("POST", "/groups/4/events", { ...base, repeat: "WEEKLY", participants: [3, 4] });
    const id = r.body.data.id as number;
    expect(call("PATCH", `/groups/4/events/${id}`, { participants: [3, 4] }, "occurrence=2027-06-08&scope=this").status).toBe(400);
    const split = call("PATCH", `/groups/4/events/${id}`, { title: "참여자테스트2" }, "occurrence=2027-06-15&scope=following");
    expect(ids(split.body.data.participants as P)).toEqual([3, 4]);
    const changed = call("PATCH", `/groups/4/events/${split.body.data.id}`, { participants: "ALL" }, "occurrence=2027-06-22&scope=following");
    expect((changed.body.data.participants as P).all).toBe(true);
  });

  it("빈 시간: 다른 팀 일정은 요청 팀 멤버가 참여자일 때만 바쁨", () => {
    const day = (q: string) => as(ME_ID, "GET", "/groups/2/free-slots", null, q).body.data.slots as { startsAt: string; endsAt: string }[];
    const q = "from=2027-07-01T00:00:00%2B09:00&to=2027-07-02T00:00:00%2B09:00&dayStart=09:00&dayEnd=23:00&minMinutes=60";
    call("POST", "/groups/4/events", { ...base, startsAt: "2027-07-01T10:00:00+09:00", endsAt: "2027-07-01T12:00:00+09:00", participants: [4] });
    // KST 시각 구간이 비는 구간 하나에 통째로 들어 있는지
    const covers = (from: string, to: string) => day(q).some((x) => x.startsAt <= from && x.endsAt >= to);
    // 아빠(4)만의 일정은 팀 2(나, 하늘) 를 막지 않는다
    expect(covers("2027-07-01T01:00:00.000Z", "2027-07-01T03:00:00.000Z")).toBe(true);
    // 하늘(2) 이 참여자면 막는다
    call("POST", "/groups/4/events", { ...base, startsAt: "2027-07-01T13:00:00+09:00", endsAt: "2027-07-01T15:00:00+09:00", participants: [2] });
    expect(covers("2027-07-01T04:00:00.000Z", "2027-07-01T06:00:00.000Z")).toBe(false);
    expect(day(q).map((x) => x.endsAt)).toContain("2027-07-01T04:00:00.000Z");
  });

  it("나가기: 그 팀 일정의 내 참여자 행이 빠지고 0 이면 참여자 없음", () => {
    const solo = call("POST", "/groups/4/events", { ...base, participants: [ME_ID] }).body.data.id as number;
    const pair = call("POST", "/groups/4/events", { ...base, participants: [ME_ID, 2] }).body.data.id as number;
    expect(call("DELETE", "/groups/4/me").status).toBe(200);
    const get = (id: number) => as(2, "GET", `/groups/4/events/${id}`).body.data.participants as P;
    expect(get(solo)).toEqual({ all: false, members: [] });
    expect(ids(get(pair))).toEqual([2]);
  });
});

describe("목 일정 색 (#343, D-215)", () => {
  const logs = () => (globalThis as unknown as { __wwmMockStore: { logs: unknown[] } }).__wwmMockStore.logs.length;
  const base = { title: "색테스트", startsAt: "2027-08-04T10:00:00+09:00", endsAt: "2027-08-04T11:00:00+09:00", allDay: false };
  type Err = { status: number; body: { error: { details: { field: string; message: string }[] } } };

  it("생성: 생략 = null, 팔레트 키는 대문자, 밖은 400 field color", () => {
    expect(call("POST", "/groups/2/events", base).body.data.color).toBeNull();
    expect(call("POST", "/groups/2/events", { ...base, color: "#f279b5" }).body.data.color).toBe("#F279B5");
    const bad = call("POST", "/groups/2/events", { ...base, color: "#123456" }) as unknown as Err;
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0]).toEqual({ field: "color", message: "색은 정해진 8색 중 하나여야 해요" });
  });

  it("한 번짜리: 색만 바꾸면 새 소식 없음, 다른 값과 같이면 하나", () => {
    const ev = call("POST", "/groups/2/events", base).body.data;
    const before = logs();
    // 웹은 폼 값 전체를 같이 보낸다
    const pink = call("PATCH", `/groups/2/events/${ev.id}`, { ...base, memo: "", color: "#F279B5" });
    expect(pink.body.data.color).toBe("#F279B5");
    expect(logs()).toBe(before);
    expect(call("PATCH", `/groups/2/events/${ev.id}`, { color: null }).body.data.color).toBeNull();
    expect(logs()).toBe(before);
    call("PATCH", `/groups/2/events/${ev.id}`, { title: "바뀜", color: "#F26D6D" });
    expect(logs()).toBe(before + 1);
  });

  it("반복: 이 일정만 + color 는 400, 이후 모두 색만은 새 소식 없이 그날부터", () => {
    const id = call("POST", "/groups/2/events", { ...base, repeat: "WEEKLY" }).body.data.id as number;
    const bad = call("PATCH", `/groups/2/events/${id}`, { color: "#F279B5" }, "occurrence=2027-08-11&scope=this") as unknown as Err;
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].field).toBe("color");
    const before = logs();
    const split = call("PATCH", `/groups/2/events/${id}`, { title: "색테스트", color: "#F279B5" }, "occurrence=2027-08-11&scope=following");
    expect(split.body.data.color).toBe("#F279B5");
    expect(logs()).toBe(before);
    const list = call("GET", "/groups/2/events", null, "from=2027-08-04T00:00:00%2B09:00&to=2027-08-19T00:00:00%2B09:00").body.data as unknown as {
      title: string;
      occurrence: string;
      color: string | null;
    }[];
    expect(list.filter((e) => e.title === "색테스트" && e.occurrence !== null).map((e) => [e.occurrence, e.color])).toEqual([
      ["2027-08-04", null],
      ["2027-08-11", "#F279B5"],
      ["2027-08-18", "#F279B5"],
    ]);
  });
});

describe("목 기념일 알림 시점 (#269)", () => {
  type Row = { id: number; reminders: string[] };
  const groupId = TEAM_ID;

  it("기존 시드와 생략은 당일만, 지정은 순서를 맞춰 저장, 잘못된 값은 400", () => {
    const list = call("GET", `/groups/${groupId}/anniversaries`).body.data as unknown as Row[];
    expect(list.find((a) => a.id === 1)?.reminders).toEqual(["DAY_OF"]);
    expect(list.find((a) => a.id === 4)?.reminders).toEqual([]);

    const plain = call("POST", `/groups/${groupId}/anniversaries`, { name: "새 기념일", date: "2025-01-01" });
    expect(plain.status).toBe(201);
    expect(plain.body.data.reminders).toEqual(["DAY_OF"]);

    const id = plain.body.data.id as number;
    const patched = call("PATCH", `/groups/${groupId}/anniversaries/${id}`, { reminders: ["WEEK_BEFORE", "DAY_BEFORE"] });
    expect(patched.body.data.reminders).toEqual(["DAY_BEFORE", "WEEK_BEFORE"]);
    expect(call("PATCH", `/groups/${groupId}/anniversaries/${id}`, { name: "이름만" }).body.data.reminders).toEqual(["DAY_BEFORE", "WEEK_BEFORE"]);

    for (const reminders of [null, "DAY_OF", ["MONTH_BEFORE"], ["DAY_OF", "DAY_OF"]]) {
      expect(call("PATCH", `/groups/${groupId}/anniversaries/${id}`, { reminders }).status).toBe(400);
    }
  });
});

describe("목 새 소식 v=2 (#191)", () => {
  it("v 없으면 일정만(kind 없음), v=2 면 활동을 시각순으로 섞는다", () => {
    const old = call("GET", `/groups/${TEAM_ID}/news`).body.data.items as Record<string, unknown>[];
    expect(old.every((i) => !("kind" in i))).toBe(true);
    const merged = call("GET", `/groups/${TEAM_ID}/news`, null, "v=2").body.data.items as { kind: string; createdAt: string }[];
    expect(merged.some((i) => i.kind === "ACTIVITY")).toBe(true);
    expect(merged.length).toBe(old.length + merged.filter((i) => i.kind === "ACTIVITY").length);
    for (let i = 1; i < merged.length; i += 1) expect(merged[i - 1].createdAt >= merged[i].createdAt).toBe(true);
  });
});

describe("(#196) 목 초대 미리보기의 초대한 사람, 이미 멤버", () => {
  const preview = (code: string, by: string | null, userId: number | null) =>
    mockHandle({ method: "GET", path: `/invites/${code}`, query: new URLSearchParams(by ? { by } : {}), body: null, userId }) as {
      status: number;
      body: { data: Record<string, unknown> };
    };

  it("GroupDetail.inviteShareUrl 은 inviteUrl?by=<내 표식>, 미리보기는 그 표식으로 내 이름을 준다", () => {
    const detail = call("GET", `/groups/${TEAM_ID}`).body.data;
    expect(detail.inviteShareUrl).toBe(`${detail.inviteUrl}?by=${inviteMarkerOf(TEAM_ID, ME_ID)}`);
    const code = String(detail.inviteCode);
    const by = inviteMarkerOf(TEAM_ID, ME_ID);
    expect(by).toMatch(/^[A-Za-z0-9_-]{10}$/);
    // 사람, 팀마다 다르다
    expect(inviteMarkerOf(TEAM_ID, ME_ID + 1)).not.toBe(by);
    expect(inviteMarkerOf(TEAM_ID + 1, ME_ID)).not.toBe(by);

    const anon = preview(code, by, null).body.data;
    expect(anon.inviter).toMatchObject({ nickname: expect.any(String) });
    expect(anon).toMatchObject({ isMember: false, groupId: null });

    expect(preview(code, "AAAAAAAAAA", null).body.data.inviter).toBeNull();
    expect(preview(code, inviteMarkerOf(TEAM_ID + 99, ME_ID), null).body.data.inviter).toBeNull();
    expect(preview(code, null, ME_ID).body.data).toMatchObject({ inviter: null, isMember: true, groupId: TEAM_ID });
  });
});

describe("(#193) 목 구독 주소", () => {
  it("없으면 null → PUT 으로 만들고, 설정만 바꾸면 주소 유지, 다시 만들기는 새 주소, 끄면 null", () => {
    const base = `/groups/${TEAM_ID}/calendar-feed`;
    expect(call("GET", base).body.data).toBeNull();
    expect(call("POST", `${base}/rotate`).status).toBe(404);
    const created = call("PUT", base, {}).body.data;
    expect(created).toMatchObject({ includeMemo: false, includeAnniversaries: true, lastFetchedAt: null });
    expect(String(created.httpsUrl)).toMatch(/^https:\/\/api\.whenwemeet\.day\/v1\/ics\/[A-Za-z0-9_-]{43}\.ics$/);
    expect(created.webcalUrl).toBe(String(created.httpsUrl).replace("https:", "webcal:"));
    const changed = call("PUT", base, { includeMemo: true }).body.data;
    expect(changed.httpsUrl).toBe(created.httpsUrl);
    expect(changed.includeMemo).toBe(true);
    expect(call("PUT", base, { includeMemo: "yes" }).status).toBe(400);
    const rotated = call("POST", `${base}/rotate`).body.data;
    expect(rotated.httpsUrl).not.toBe(created.httpsUrl);
    expect(call("DELETE", base).body.data).toEqual({ ok: true });
    expect(call("GET", base).body.data).toBeNull();
  });
});

describe("목 참석 여부와 반응 (#190)", () => {
  // 앞 테스트가 팀을 나가거나 일정을 바꿨을 수 있어 새 보관소로 시작한다
  beforeAll(() => {
    (globalThis as unknown as { __wwmMockStore?: unknown }).__wwmMockStore = undefined;
  });
  type Detail = { rsvp: { mine: string | null; going: number }; reactions: { mine: string | null }; rsvpMembers: { member: { userId: number }; status: string | null }[] };
  const detail = (id: number) => call("GET", `/groups/${FAMILY_ID}/events/${id}`).body.data as unknown as Detail;

  it("참여자는 정하고 바꾸고 취소한다. 참여자가 아니면 403 NOT_PARTICIPANT, 형식 오류는 400", () => {
    const r = call("PUT", `/groups/${FAMILY_ID}/events/21/rsvp`, { status: "GOING" });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ mine: "GOING", going: 2 });
    expect(detail(21).rsvpMembers.find((x) => x.member.userId === ME_ID)?.status).toBe("GOING");
    expect(call("PUT", `/groups/${FAMILY_ID}/events/21/rsvp`, { status: null }).body.data).toMatchObject({ mine: null });
    // 할머니 댁(27) 은 내가 참여자가 아니다
    const denied = mockHandle({ method: "PUT", path: `/groups/${FAMILY_ID}/events/27/rsvp`, query: new URLSearchParams(), body: { status: "GOING" }, userId: ME_ID });
    expect(denied.status).toBe(403);
    expect(call("PUT", `/groups/${FAMILY_ID}/events/21/rsvp`, { status: "YES" }).status).toBe(400);
  });

  it("반응은 팀원 누구나, null 은 취소. 목록에는 집계만", () => {
    expect(call("PUT", `/groups/${FAMILY_ID}/events/27/reaction`, { reaction: "ACK" }).body.data).toMatchObject({ ACK: 1, mine: "ACK" });
    expect(call("PUT", `/groups/${FAMILY_ID}/events/27/reaction`, { reaction: null }).body.data).toMatchObject({ ACK: 0, mine: null });
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const list = call("GET", `/groups/${FAMILY_ID}/events`, null, `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).body.data as unknown as Record<string, unknown>[];
    expect(list.every((e) => "rsvp" in e && "reactions" in e && !("rsvpMembers" in e))).toBe(true);
  });

  it("반복 회차는 occurrence 필수, 회차마다 따로", () => {
    const created = call("POST", `/groups/${FAMILY_ID}/events`, {
      title: "주간 모임",
      startsAt: "2027-03-03T19:00:00+09:00",
      endsAt: "2027-03-03T21:00:00+09:00",
      allDay: false,
      repeat: "WEEKLY",
      participants: "ALL",
    });
    const id = created.body.data.id as number;
    expect(call("PUT", `/groups/${FAMILY_ID}/events/${id}/rsvp`, { status: "GOING" }).status).toBe(400);
    expect(call("PUT", `/groups/${FAMILY_ID}/events/${id}/rsvp`, { status: "GOING" }, "occurrence=2027-03-04").status).toBe(404);
    expect(call("PUT", `/groups/${FAMILY_ID}/events/${id}/rsvp`, { status: "NOT_GOING" }, "occurrence=2027-03-10").status).toBe(200);
    const one = (date: string) => call("GET", `/groups/${FAMILY_ID}/events/${id}`, null, `occurrence=${date}`).body.data as unknown as Detail;
    expect(one("2027-03-10").rsvp.mine).toBe("NOT_GOING");
    expect(one("2027-03-17").rsvp.mine).toBeNull();
  });
});

describe("목 멤버 생일 (#305)", () => {
  it("PATCH /me/birthday 검증과 저장, GET /me, 팀 목록, 팀별 끄기", () => {
    const list = () => call("GET", `/groups/${TEAM_ID}/birthdays`).body.data as unknown as { member: { userId: number }; date: string }[];
    expect(call("PATCH", "/me/birthday", { date: "02-30" }).status).toBe(400);
    expect(call("PATCH", "/me/birthday", { date: "03-05", reminders: ["NOW"] }).status).toBe(400);
    expect(call("PATCH", "/me/birthday", { date: "02-29", reminders: ["DAY_BEFORE", "DAY_OF"] }).body.data).toEqual({ date: "02-29", reminders: ["DAY_OF", "DAY_BEFORE"] });
    expect(call("GET", "/me").body.data.birthday).toEqual({ date: "02-29", reminders: ["DAY_OF", "DAY_BEFORE"] });
    expect(list().find((b) => b.member.userId === ME_ID)?.date).toBe("02-29");
    expect(call("GET", `/groups/${PERSONAL_ID}/birthdays`).body.data).toHaveLength(1);

    expect(call("PATCH", `/groups/${TEAM_ID}/me`, { showBirthday: "no" }).status).toBe(400);
    expect(call("PATCH", `/groups/${TEAM_ID}/me`, { showBirthday: false }).body.data.showBirthday).toBe(false);
    expect(list().some((b) => b.member.userId === ME_ID)).toBe(false);
    expect((call("GET", `/groups/${TEAM_ID}`).body.data.me as { showBirthday: boolean }).showBirthday).toBe(false);
    call("PATCH", `/groups/${TEAM_ID}/me`, { showBirthday: true });
    expect(call("PATCH", "/me/birthday", { date: null }).body.data.date).toBeNull();
    expect(list().some((b) => b.member.userId === ME_ID)).toBe(false);
  });
});
