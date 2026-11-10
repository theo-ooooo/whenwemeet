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
