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
});
