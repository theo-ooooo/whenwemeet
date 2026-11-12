// @vitest-environment happy-dom
// (#314) 미리보기 달력에서 골라서 넣기: 달 이동, 날짜 시트, 달 단위 선택, 전체 선택, 개수 표시, 기간 변경 시 초기화, 넣기 요청의 include
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportInput } from "@/hooks";
import type { ImportItem, ImportPreview } from "@/lib/types";

const preview = vi.fn<(input: ImportInput) => Promise<unknown>>();
const importEvents = vi.fn<(input: ImportInput) => Promise<unknown>>();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/useInApp", () => ({ useInApp: () => false }));
vi.mock("@/components/AppShell", () => ({
  useGroupContext: () => ({
    groupId: 7,
    groups: [{ id: 7, name: "우리", type: "TEAM" }],
    eventsChanged: vi.fn(),
  }),
}));
vi.mock("@/hooks", () => ({
  messageOf: (e: { message?: string } | null, fallback: string) => e?.message || fallback,
  usePreviewImport: () => ({ mutate: preview, isPending: false, error: null }),
  useImportEvents: () => ({ mutate: importEvents, isPending: false, error: null }),
}));

const { ImportScreen } = await import("../ImportScreen");

const at = (iso: string, hours = 1) => ({ startsAt: iso, endsAt: new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString() });
const item = (key: string, iso: string, title = key): ImportItem => ({ key: key.padStart(64, "0"), title, allDay: false, repeat: null, ...at(iso) });
// 11월 3개(12일 둘), 12월 2개 (KST). 2027년 3월 하나 (가운데 빈 달은 건너뛴다)
const ITEMS = [
  item("1", "2026-11-12T01:00:00.000Z", "치과"),
  item("2", "2026-11-12T05:00:00.000Z", "회의"),
  { ...item("3", "2026-11-20T01:00:00.000Z", "영어"), repeat: "WEEKLY" as const },
  item("4", "2026-12-02T01:00:00.000Z", "여행"),
  item("5", "2026-12-24T01:00:00.000Z", "파티"),
  item("6", "2027-03-03T01:00:00.000Z", "봄"),
];
const previewOf = (items: ImportItem[]): ImportPreview => ({
  total: items.length,
  toCreate: items.length,
  recurringKept: 0,
  expanded: 0,
  expandedSeries: 0,
  skipped: [],
  firstStartsAt: items[0]?.startsAt ?? null,
  lastStartsAt: items.at(-1)?.startsAt ?? null,
  warnings: [],
  sample: [],
  items,
});
const ok = <T,>(data: T) => Promise.resolve({ ok: true, data, error: null });

async function pickFile() {
  const view = render(<ImportScreen />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["BEGIN:VCALENDAR"], "a.ics", { type: "text/calendar" })] } });
  });
  await screen.findByText("6개 중 6개 선택");
  return view;
}
const box = (name: string | RegExp) => screen.getByRole("checkbox", { name });
const day = (name: RegExp) => screen.getByRole("button", { name });
const monthSelect = () => screen.getByRole("combobox", { name: "달 고르기" }) as HTMLSelectElement;
const submit = () => screen.getByRole("button", { name: /넣기$|골라 주세요|넣을 일정이 없어요/ });

describe("ImportScreen 달력에서 골라서 넣기 (#314)", () => {
  beforeEach(() => {
    preview.mockImplementation(() => ok(previewOf(ITEMS)));
    importEvents.mockImplementation((input) => ok({ importId: 1, created: input.include?.length ?? 0, skipped: [] }));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("첫 달 격자, 일정 있는 달만 이동(◀ ▶, 고르기), 기본 전부 선택", async () => {
    await pickFile();
    expect(monthSelect().value).toBe("2026-11");
    expect([...monthSelect().options].map((o) => o.textContent)).toEqual(["2026년 11월 (3)", "2026년 12월 (2)", "2027년 3월 (1)"]);
    expect(screen.getByRole("list", { name: "2026년 11월 날짜" }).children).toHaveLength(42);
    expect(day(/11월 12일 \(목\), 일정 2개 중 2개 선택/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "이전 달" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
    fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
    expect(monthSelect().value).toBe("2027-03");
    expect((screen.getByRole("button", { name: "다음 달" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(monthSelect(), { target: { value: "2026-12" } });
    expect(screen.getByRole("list", { name: "2026년 12월 날짜" })).toBeTruthy();
    expect(box("전체").getAttribute("aria-checked")).toBe("true");
    expect(submit().textContent).toBe("우리에 6개 넣기");
  });

  it("날짜 시트: 줄 하나 빼기, 이날 전체 빼기. 달 전체 빼기. 고른 key 만 보낸다", async () => {
    await pickFile();
    fireEvent.click(day(/11월 12일/));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /회의/ }));
    expect(screen.getByText("6개 중 5개 선택")).toBeTruthy();
    expect(within(sheet).getByRole("checkbox", { name: /이날 일부만 넣기/ }).getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /이날 일부만 넣기/ }));
    expect(screen.getByText("6개 중 6개 선택")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /이날 전체 넣기/ }));
    expect(screen.getByText("6개 중 4개 선택")).toBeTruthy();
    expect(within(sheet).getByRole("checkbox", { name: /이날 전체 빼기/ }).getAttribute("aria-checked")).toBe("false");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // 칸은 뺀 상태를 알린다
    expect(day(/11월 12일 \(목\), 일정 2개 중 0개 선택/)).toBeTruthy();
    expect(box("2026년 11월 전체").getAttribute("aria-checked")).toBe("mixed");

    // 12월 전체 빼기
    fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
    fireEvent.click(box("2026년 12월 전체"));
    expect(screen.getByText("6개 중 2개 선택")).toBeTruthy();
    expect(box("전체").getAttribute("aria-checked")).toBe("mixed");

    await act(async () => fireEvent.click(submit()));
    expect(importEvents.mock.calls[0][0].include).toEqual([ITEMS[2].key, ITEMS[5].key]);
    expect(await screen.findByText("2개를 넣었어요")).toBeTruthy();
    expect(screen.getByText("뺀 일정 4개는 넣지 않았어요. 같은 파일을 다시 올리면 다시 고를 수 있어요")).toBeTruthy();
  });

  it("전체 해제하면 버튼이 비활성, 다시 누르면 전부 선택", async () => {
    await pickFile();
    fireEvent.click(box("전체"));
    expect(screen.getByText("6개 중 0개 선택")).toBeTruthy();
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    expect(submit().textContent).toBe("넣을 일정을 골라 주세요");
    fireEvent.click(box("전체"));
    expect(screen.getByText("6개 중 6개 선택")).toBeTruthy();
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
  });

  it("기간을 바꿔 미리보기를 다시 받으면 선택은 다시 전부, 달은 첫 달로", async () => {
    await pickFile();
    fireEvent.click(box("2026년 11월 전체"));
    fireEvent.change(monthSelect(), { target: { value: "2027-03" } });
    expect(screen.getByText("6개 중 3개 선택")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "전체" })));
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ range: "all" }));
    expect(await screen.findByText("6개 중 6개 선택")).toBeTruthy();
    expect(monthSelect().value).toBe("2026-11");
    expect(box("2026년 11월 전체").getAttribute("aria-checked")).toBe("true");
  });

  it("넣을 일정이 없으면 달력 없이 비활성 버튼", async () => {
    preview.mockImplementation(() => ok(previewOf([])));
    const view = render(<ImportScreen />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "a.ics", { type: "text/calendar" })] } });
    });
    await waitFor(() => expect(submit().textContent).toBe("넣을 일정이 없어요"));
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("combobox", { name: "달 고르기" })).toBeNull();
  });
});
