// @vitest-environment happy-dom
// (#378) 설정 줄: RowButton "아이콘 이름 ··· 값 ›", RowLink 값, ToggleRow(switch, 설명 한 줄), RowGroup(묶음 제목, 안내)
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const { RowButton, RowGroup, RowLink, ToggleRow } = await import("../ui");
const { IconBell, IconPalette, IconRepeat } = await import("../icons");

afterEach(cleanup);

describe("설정 줄", () => {
  it("RowButton: 아이콘(장식), 이름, 값, › 를 한 버튼 안에. 누르면 시트를 연다", () => {
    const open = vi.fn();
    render(<RowButton icon={<IconRepeat size={18} />} label="반복" value="매주" onClick={open} aria-haspopup="dialog" />);
    const row = screen.getByRole("button", { name: /반복/ });
    expect(row.textContent).toBe("반복매주");
    expect(row.querySelectorAll("svg")).toHaveLength(2);
    expect(row.querySelector('[aria-hidden="true"] svg')).toBeTruthy();
    fireEvent.click(row);
    expect(open).toHaveBeenCalled();
  });

  it("(#378) 새 선 아이콘(반복, 색)은 24 격자 장식, 색은 겹침 조각 하나", () => {
    render(<RowButton icon={<IconPalette size={18} active />} label="색" value="자동" />);
    const svg = screen.getByRole("button").querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll("[data-piece]")).toHaveLength(1);
    expect(svg.querySelector("[data-piece]")?.getAttribute("fill")).toBe("var(--pri)");
  });

  it("RowLink: 값을 주면 설정 줄, 안 주면 예전 시작 안내 모양", () => {
    render(<RowLink href="/team/import" label="일정 가져오기" value="구글, 애플" icon={<IconBell size={18} />} />);
    const link = screen.getByRole("link", { name: /일정 가져오기/ });
    expect(link.getAttribute("href")).toBe("/team/import");
    expect(link.textContent).toBe("일정 가져오기구글, 애플");
    cleanup();
    render(<RowLink href="/x" label="안내" icon={<IconBell size={18} />} />);
    expect(screen.getByRole("link").querySelector(".text-acc-ink")).toBeTruthy();
  });

  it("ToggleRow: switch 역할, 설명은 aria-describedby, 줄 어디를 눌러도 바뀐다, 막히면 안 바뀐다", () => {
    const change = vi.fn();
    const { rerender } = render(<ToggleRow label="이 팀 알림 받기" description="일정 추가, 바뀜 알림" checked={false} onChange={change} />);
    const sw = screen.getByRole("switch", { name: /이 팀 알림 받기/ });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    const desc = document.getElementById(sw.getAttribute("aria-describedby")!);
    expect(desc?.textContent).toBe("일정 추가, 바뀜 알림");
    fireEvent.click(sw);
    expect(change).toHaveBeenLastCalledWith(true);
    rerender(<ToggleRow label="이 팀 알림 받기" checked onChange={change} disabled />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch").getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("ToggleRow: 키보드(Enter, Space)는 버튼 기본 동작", () => {
    const change = vi.fn();
    render(<ToggleRow label="생일 보이기" checked onChange={change} />);
    const sw = screen.getByRole("switch");
    sw.focus();
    expect(document.activeElement).toBe(sw);
    expect(sw.tagName).toBe("BUTTON");
    expect(sw.getAttribute("type")).toBe("button");
  });

  it("RowGroup: 제목이 있으면 그 이름의 구역, 줄 사이 구분선, 아래 안내", () => {
    render(
      <RowGroup title="나" hint="팀원에게 보이는 내 이름과 색이에요">
        <RowButton label="내 이름" value="지우" />
        <ToggleRow label="생일 보이기" checked onChange={() => {}} />
      </RowGroup>,
    );
    const group = screen.getByRole("region", { name: "나" });
    const card = group.querySelector(".divide-y");
    expect(card?.children).toHaveLength(2);
    expect(card?.className).toContain("bg-paper");
    expect(screen.getByText("팀원에게 보이는 내 이름과 색이에요")).toBeTruthy();
    cleanup();
    render(
      <RowGroup>
        <RowButton label="a" />
      </RowGroup>,
    );
    expect(screen.queryByRole("region")).toBeNull();
  });
});
