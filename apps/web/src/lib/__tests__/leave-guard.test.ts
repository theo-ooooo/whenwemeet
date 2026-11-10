import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmLeave, isInternalNavClick, setLeaveGuard } from "../leave-guard";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const here = { origin: "http://localhost:3140", href: "http://localhost:3140/g/2/events/new?start=a" };
const a = (href: string, target = "", hasDownload = false) => ({ href, target, hasDownload });

describe("isInternalNavClick (#137)", () => {
  it("앱 안 다른 화면", () => {
    expect(isInternalNavClick(click, a("http://localhost:3140/g/2/free"), here)).toBe(true);
    expect(isInternalNavClick(click, a("/g/2/calendar"), here)).toBe(true);
  });
  it("같은 주소, 바깥 주소, 새 탭, 수정 키, 다운로드는 아님", () => {
    expect(isInternalNavClick(click, a(here.href), here)).toBe(false);
    expect(isInternalNavClick(click, a("https://example.com/"), here)).toBe(false);
    expect(isInternalNavClick(click, a("/g/2/free", "_blank"), here)).toBe(false);
    expect(isInternalNavClick({ ...click, metaKey: true }, a("/g/2/free"), here)).toBe(false);
    expect(isInternalNavClick({ ...click, button: 1 }, a("/g/2/free"), here)).toBe(false);
    expect(isInternalNavClick({ ...click, defaultPrevented: true }, a("/g/2/free"), here)).toBe(false);
    expect(isInternalNavClick(click, a("/file.ics", "", true), here)).toBe(false);
  });
});

describe("confirmLeave", () => {
  afterEach(() => setLeaveGuard(null));

  it("확인이 없으면 바로 이동", () => {
    const go = vi.fn();
    confirmLeave(go);
    expect(go).toHaveBeenCalledOnce();
  });

  it("확인이 걸려 있으면 확인 함수에 이동을 넘긴다", () => {
    const go = vi.fn();
    const guard = vi.fn();
    setLeaveGuard(guard);
    confirmLeave(go);
    expect(go).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledWith(go);
  });
});
