import { afterEach, describe, expect, it, vi } from "vitest";
import { getMockFile, MOCK_FILE_PREFIX, putMockFile } from "../files";
import { mockHandle } from "../handler";
import { ME_ID } from "../fixtures";

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

  it("알림 설정: 기본 모두 켬, 바꾼 키만, 불리언 아니면 400", () => {
    expect(call("GET", "/me/notification-settings").body.data).toEqual({ reminder: true, change: true, anniversary: true, join: true });
    expect(call("PATCH", "/me/notification-settings", { change: false }).body.data).toEqual({ reminder: true, change: false, anniversary: true, join: true });
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
