// @vitest-environment happy-dom
// (#378) 팀 설정: 묶음 셋(팀, 나, 연결)의 줄, 줄을 누르면 시트("바꾸기" 버튼 없음), ?invite=1 / ?feed=1 로 시트를 연 채 시작,
// 내 색과 표시 이름 저장, 알림 토글은 바로 저장하고 실패하면 되돌림, 팀 나가기는 확인 뒤. 화면 어디에도 "구독" 이 없다
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupDetail } from "@/lib/types";

const updateGroup = vi.fn();
const updateMembership = vi.fn();
const rotate = vi.fn();
const leave = vi.fn();
const show = vi.fn();
const replace = vi.fn();
let group: GroupDetail;
const setGroup = vi.fn((g: GroupDetail) => {
  group = g;
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ show }) }));
vi.mock("@/components/CalendarFeedSection", () => ({ CalendarFeedSection: ({ bare }: { bare?: boolean }) => <p>연결 주소 칸{bare ? " (시트)" : ""}</p> }));
vi.mock("@/lib/kakao-share", () => ({ preloadKakaoSdk: () => undefined, inviteKakaoFeed: () => null, shareKakaoFeed: vi.fn() }));
vi.mock("@/lib/group-cookie", () => ({ forgetGroup: vi.fn() }));
vi.mock("@/components/AppShell", () => ({
  useGroupContext: () => ({ groupId: group.id, group, error: null, refresh: vi.fn(), setGroup }),
}));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  useUpdateGroup: () => ({ mutate: updateGroup, isPending: false, error: null }),
  useUpdateMembership: () => ({ mutate: updateMembership, isPending: false, error: null }),
  useRotateInviteCode: () => ({ mutate: rotate, isPending: false, error: null }),
  useLeaveGroup: () => ({ mutate: leave, isPending: false, error: null }),
}));

const { SettingsScreen } = await import("../SettingsScreen");

const jiu = { userId: 1, displayName: "지우", color: "#F26D6D", profileImageUrl: null, notify: true, showBirthday: true };
const haneul = { userId: 2, displayName: "하늘", color: "#F2C94C", profileImageUrl: null };
const TEAM = {
  id: 2,
  type: "TEAM",
  name: "우리 둘",
  inviteCode: "WM7K2Q",
  inviteUrl: "https://whenwemeet.day/join/WM7K2Q",
  inviteShareUrl: "https://whenwemeet.day/join/WM7K2Q?by=abc",
  publicCode: "team2xxx",
  createdAt: "2026-11-01T00:00:00.000Z",
  members: [jiu, haneul],
  me: jiu,
} as unknown as GroupDetail;

const ok = <T,>(data: T) => ({ ok: true, data, error: null });

describe("SettingsScreen (#378)", () => {
  beforeEach(() => {
    group = structuredClone(TEAM);
    for (const f of [updateGroup, updateMembership, rotate, leave, show, replace, setGroup]) f.mockClear();
  });
  afterEach(cleanup);

  it("묶음 셋과 줄. '바꾸기' 버튼이 없고, 멤버는 팀 묶음 안", () => {
    render(<SettingsScreen openInvite={false} />);
    const team = screen.getByRole("region", { name: "팀" });
    expect(within(team).getByRole("button", { name: /팀 이름/ }).textContent).toContain("우리 둘");
    expect(within(team).getByRole("button", { name: /초대하기/ }).textContent).toContain("WM7K2Q");
    expect(within(team).getByText("하늘")).toBeTruthy();
    const me = screen.getByRole("region", { name: "나" });
    expect(within(me).getByRole("button", { name: /내 색/ }).textContent).toContain("블루");
    expect(within(me).getByRole("switch", { name: /이 팀 알림 받기/ }).getAttribute("aria-checked")).toBe("true");
    expect(within(me).getByRole("switch", { name: /이 팀 달력에 내 생일 보이기/ })).toBeTruthy();
    const link = screen.getByRole("region", { name: "연결" });
    expect(within(link).getByRole("button", { name: /다른 캘린더 앱에서 보기/ })).toBeTruthy();
    expect(within(link).getByRole("link", { name: /일정 가져오기/ }).getAttribute("href")).toBe("/team/import");
    expect(screen.queryByRole("button", { name: /바꾸기$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "팀 나가기" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("구독");
  });

  it("?invite=1 이면 초대 시트(코드, 링크 복사, 카카오톡 공유)를 연 채로", () => {
    render(<SettingsScreen openInvite />);
    const sheet = screen.getByRole("dialog", { name: "초대하기" });
    expect(within(sheet).getByLabelText("초대 코드 W M 7 K 2 Q")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "링크 복사" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /카카오톡으로 공유/ })).toBeTruthy();
  });

  it("(#278) ?feed=1 이면 '다른 캘린더 앱에서 보기' 시트를 연 채로, 줄을 눌러도 같은 시트", () => {
    render(<SettingsScreen openInvite={false} showFeed />);
    expect(within(screen.getByRole("dialog", { name: "다른 캘린더 앱에서 보기" })).getByText("연결 주소 칸 (시트)")).toBeTruthy();
    cleanup();
    render(<SettingsScreen openInvite={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /다른 캘린더 앱에서 보기/ }));
    expect(screen.getByRole("dialog", { name: "다른 캘린더 앱에서 보기" })).toBeTruthy();
  });

  it("팀 이름 줄 → 이름 시트에서 저장, 응답으로 팀 정보를 바꾸고 닫는다", async () => {
    updateGroup.mockResolvedValue(ok({ ...TEAM, name: "우리 셋" }));
    render(<SettingsScreen openInvite={false} />);
    fireEvent.click(screen.getByRole("button", { name: /팀 이름/ }));
    const sheet = screen.getByRole("dialog", { name: "팀 이름" });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "팀 이름" }), { target: { value: "우리 셋" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "저장" }));
    });
    expect(updateGroup).toHaveBeenCalledWith({ name: "우리 셋" });
    expect(setGroup).toHaveBeenCalledWith(expect.objectContaining({ name: "우리 셋" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("내 색 시트: 고르면 바로 저장하고 닫는다", async () => {
    updateMembership.mockResolvedValue(ok({ ...jiu, color: "#F2C94C" }));
    render(<SettingsScreen openInvite={false} />);
    fireEvent.click(screen.getByRole("button", { name: /내 색/ }));
    const sheet = screen.getByRole("dialog", { name: "내 색" });
    const radios = within(sheet).getAllByRole("radio");
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("radio", { name: "민트" }));
    });
    expect(updateMembership).toHaveBeenCalledWith(expect.objectContaining({ displayName: "지우" }));
    expect(show).toHaveBeenCalledWith("내 색을 바꿨어요");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("알림 토글은 바로 바꿔 보이고 저장, 실패하면 되돌리고 토스트", async () => {
    updateMembership.mockResolvedValue({ ok: false, data: null, error: { message: "" } });
    render(<SettingsScreen openInvite={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /이 팀 알림 받기/ }));
    });
    expect(updateMembership).toHaveBeenCalledWith({ notify: false });
    expect(setGroup.mock.calls[0][0].me.notify).toBe(false);
    expect(setGroup.mock.calls.at(-1)?.[0].me.notify).toBe(true);
    expect(show).toHaveBeenCalledWith("알림 설정을 바꾸지 못했어요. 다시 시도해 주세요");
  });

  it("팀 나가기: 확인 창 뒤에만 나간다", async () => {
    leave.mockResolvedValue(ok(null));
    render(<SettingsScreen openInvite={false} />);
    fireEvent.click(screen.getByRole("button", { name: "팀 나가기" }));
    const dialog = screen.getByRole("alertdialog", { name: "팀을 나갈까요?" });
    expect(leave).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "나가기" }));
    });
    expect(leave).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/");
  });
});
