import { clearSnapshot, loadSnapshot, publishTimeline, saveSnapshot, type SnapshotFile, type TimelineWidget } from "../store";
import { SIGNED_OUT_PROPS, toNativeProps } from "../snapshot";
import { NOW, sample } from "./fixture";

function memFile(initial: string | null = null): SnapshotFile & { text: string | null } {
  return {
    text: initial,
    read() {
      return this.text;
    },
    write(t) {
      this.text = t;
    },
    remove() {
      this.text = null;
    },
  };
}

describe("Android 저장 (파일)", () => {
  it("저장 후 다시 읽으면 같은 스냅샷", () => {
    const f = memFile();
    saveSnapshot(f, sample());
    expect(loadSnapshot(f)).toEqual(sample());
  });

  it("없음, 깨진 JSON, 검사 실패, 읽기 예외는 null (위젯은 로그인 안내)", () => {
    expect(loadSnapshot(memFile())).toBeNull();
    expect(loadSnapshot(memFile("{nope"))).toBeNull();
    expect(loadSnapshot(memFile(JSON.stringify({ ...sample(), groups: "x" })))).toBeNull();
    const broken: SnapshotFile = {
      read: () => {
        throw new Error("io");
      },
      write: () => undefined,
      remove: () => undefined,
    };
    expect(loadSnapshot(broken)).toBeNull();
  });

  it("비우기(로그아웃, 탈퇴) 후에는 이전 사용자 데이터가 없다. 지우기 실패도 던지지 않는다", () => {
    const f = memFile();
    saveSnapshot(f, sample());
    clearSnapshot(f);
    expect(f.text).toBeNull();
    expect(loadSnapshot(f)).toBeNull();
    expect(() =>
      clearSnapshot({
        read: () => null,
        write: () => undefined,
        remove: () => {
          throw new Error("없음");
        },
      }),
    ).not.toThrow();
  });
});

describe("iOS 타임라인", () => {
  const fake = () => {
    const calls: Parameters<TimelineWidget["updateTimeline"]>[0][] = [];
    const w: TimelineWidget = { updateTimeline: (e) => void calls.push(e), reload: () => undefined };
    return { w, calls };
  };

  it("스냅샷이면 날짜별 항목", () => {
    const { w, calls } = fake();
    publishTimeline(w, sample(), NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0].length).toBeGreaterThan(7);
    expect(calls[0][0].props.kind).toBe("today");
  });

  it("비우기는 로그인 안내 하나로 덮는다 (이전 항목이 남지 않음)", () => {
    const { w, calls } = fake();
    publishTimeline(w, sample(), NOW);
    publishTimeline(w, null, NOW);
    expect(calls[1]).toEqual([{ date: new Date(NOW), props: toNativeProps(SIGNED_OUT_PROPS) }]);
  });

  // (#462) iOS 네이티브는 null 이 든 props 를 받으면 예외를 낸다 (시작 때면 앱이 꺼짐)
  it("네이티브로 넘기는 props 에 null 이 없다", () => {
    const { w, calls } = fake();
    publishTimeline(w, sample(), NOW);
    publishTimeline(w, null, NOW);
    const hasNull = (v: unknown): boolean => v === null || (typeof v === "object" && v !== undefined && Object.values(v as object).some(hasNull));
    for (const entries of calls) for (const e of entries) expect(hasNull(e.props)).toBe(false);
  });
});

describe("toNativeProps", () => {
  it("null 키를 빼고 나머지는 그대로 (중첩, 배열 포함)", () => {
    const p = toNativeProps({
      ...SIGNED_OUT_PROPS,
      kind: "today",
      rows: [{ title: "a", time: "9:00", color: 1, team: null }],
      anniversary: null,
    });
    expect(p).toEqual({ ...SIGNED_OUT_PROPS, kind: "today", rows: [{ title: "a", time: "9:00", color: 1 }], anniversary: undefined });
    expect("anniversary" in p).toBe(false);
    expect("team" in p.rows[0]).toBe(false);
  });

  it("값이 있으면 남긴다", () => {
    const ann = { title: "생일", dday: "D-3", url: "whenwemeet://x" };
    expect(toNativeProps({ ...SIGNED_OUT_PROPS, anniversary: ann }).anniversary).toEqual(ann);
  });
});
