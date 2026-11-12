// (#315) 사이드바 접힘 기본값과 저장
import { describe, expect, it } from "vitest";
import { isCollapsed, parseSidebarPref, readSidebarPref, SIDEBAR_KEY, writeSidebarPref } from "../sidebar-fold";

describe("isCollapsed", () => {
  it("저장값이 없으면 fold 접힘, pc 펼침", () => {
    expect(isCollapsed(null, "fold")).toBe(true);
    expect(isCollapsed(null, "pc")).toBe(false);
    expect(isCollapsed(null, "phone")).toBe(false);
  });
  it("한 번 바꾸면 폭과 관계없이 그 값", () => {
    expect(isCollapsed("expanded", "fold")).toBe(false);
    expect(isCollapsed("collapsed", "pc")).toBe(true);
  });
});

describe("저장 (localStorage wwm_sidebar)", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("읽고 쓰기, 모르는 값은 null", () => {
    const s = mem();
    expect(readSidebarPref(s)).toBeNull();
    writeSidebarPref(s, "collapsed");
    expect(s.m.get(SIDEBAR_KEY)).toBe("collapsed");
    expect(readSidebarPref(s)).toBe("collapsed");
    s.m.set(SIDEBAR_KEY, "weird");
    expect(readSidebarPref(s)).toBeNull();
    expect(parseSidebarPref("expanded")).toBe("expanded");
  });
  it("막힌 저장소(예외)와 없는 저장소는 조용히 넘어간다", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readSidebarPref(broken)).toBeNull();
    expect(() => writeSidebarPref(broken, "collapsed")).not.toThrow();
    expect(readSidebarPref(null)).toBeNull();
  });
});
