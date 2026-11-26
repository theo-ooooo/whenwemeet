// @vitest-environment happy-dom
// (#552, D-295) 폰에서 ‹ 제목 하위 화면(ScreenHeader)이 있으면 앱 위쪽 바를 숨긴다.
// 판단은 globals.css 의 :has() 규칙 하나라 화면 목록이 없다. 여기서는 그 규칙이 (1) 폰 폭에만 걸리고 (2) 본문 안 머리줄만 보며
// (3) AppShell, ScreenHeader, 하위 화면 뼈대(ScreenLoading)가 그 규칙이 찾는 표시를 실제로 다는지 본다
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("@/lib/back-nav", () => ({ canGoBack: () => false }));

const { ScreenHeader } = await import("../ScreenHeader");
const { ScreenLoading } = await import("../ScreenLoading");

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const css = read("../../app/globals.css");

/** globals.css 에서 위쪽 바를 숨기는 규칙: { media, selector } */
function topbarRule() {
  const m = css.match(/@media \(([^)]*)\) \{\s*([^{}]*\[data-app-topbar\])\s*\{\s*display: none;\s*\}\s*\}/);
  if (!m) throw new Error("위쪽 바 숨김 규칙이 없다");
  return { media: m[1], selector: m[2].trim() };
}

/**
 * 규칙 선택자 `조상:has(안쪽) 대상` 으로 고른 요소. happy-dom 의 :has() 는 자손 결합자를 제대로 풀지 못해
 * 같은 뜻을 querySelector 로 펼쳐 본다: 대상의 조상 중 `조상` 에 맞고 그 안에 `안쪽` 이 있는 것이 있으면 고른다
 */
function selectByRule(selector: string): Element[] {
  const m = selector.match(/^(.+?):has\((.+)\)\s+(.+)$/);
  if (!m) throw new Error(`:has 규칙 모양이 아니다: ${selector}`);
  const [, outer, inner, target] = m;
  return [...document.querySelectorAll(target)].filter((el) => {
    for (let a = el.parentElement; a; a = a.parentElement) if (a.matches(outer) && a.querySelector(inner)) return true;
    return false;
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("(#552) 위쪽 바 숨김 규칙", () => {
  it("폰 폭(<600, fold 미만)에만 건다", () => {
    expect(topbarRule().media).toBe("width < 600px");
    // fold 구간 시작과 같은 값이어야 넓은 화면(사이드바)과 겹치거나 비는 폭이 없다
    expect(css).toMatch(/--breakpoint-fold: 600px;/);
  });

  it("본문(main) 안에 ScreenHeader 가 있을 때만 위쪽 바를 고른다", () => {
    const { selector } = topbarRule();
    const shell = (body: string, outside = "") =>
      `<div data-app-shell=""><header data-app-topbar=""></header><main>${body}</main></div>${outside}`;

    document.body.innerHTML = shell(`<div><div data-screen-header=""></div></div>`);
    expect(selectByRule(selector)).toHaveLength(1);

    // 탭 화면(머리줄 없음)
    document.body.innerHTML = shell(`<h1>달력</h1>`);
    expect(selectByRule(selector)).toHaveLength(0);

    // 시트, 창(본문 밖 포털)에 머리줄이 있어도 위쪽 바는 그대로
    document.body.innerHTML = shell(`<h1>달력</h1>`, `<div role="dialog"><div data-screen-header=""></div></div>`);
    expect(selectByRule(selector)).toHaveLength(0);
  });

  it("AppShell 이 규칙이 찾는 뼈대와 위쪽 바 표시를 단다", () => {
    const src = read("../AppShell.tsx");
    expect(src).toContain('data-app-shell=""');
    expect(src).toMatch(/<header data-app-topbar=""/);
    expect(src).toMatch(/<main\b/);
  });
});

describe("(#552) ScreenHeader 가 폰에서 맨 위 줄을 맡는다", () => {
  it("data-screen-header 를 달고, 폰에서는 안전 영역 여백 + 위에 붙는 바탕, 넓은 화면은 예전 그대로", () => {
    const { container } = render(<ScreenHeader title="새 소식" fallbackHref="/calendar" back="phone" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.hasAttribute("data-screen-header")).toBe(true);
    const cls = root.className.split(/\s+/);
    for (const c of ["sticky", "top-0", "bg-surface", "-mx-5", "px-5", "pt-[calc(4px+env(safe-area-inset-top))]"]) expect(cls).toContain(c);
    for (const c of ["fold:static", "fold:mx-0", "fold:px-0", "fold:bg-transparent", "fold:pt-1"]) expect(cls).toContain(c);
  });

  it("하위 화면 뼈대(loading)는 back 을 주면 같은 머리줄을 그려 뼈대 동안에도 위쪽 바가 숨는다", () => {
    const { container } = render(<ScreenLoading title="새 소식" back={{ fallbackHref: "/calendar", phoneOnly: true }} />);
    expect(container.querySelector("[data-screen-header]")).not.toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("새 소식");
  });

  it("탭 화면 뼈대(back 없음)는 머리줄을 달지 않는다", () => {
    const { container } = render(<ScreenLoading title="빈 시간 찾기" />);
    expect(container.querySelector("[data-screen-header]")).toBeNull();
  });
});
