import { addDays, type WidgetSnapshot } from "../snapshot";

// 2026-11-12(목) 09:00 KST = 00:00Z
export const GEN = "2026-11-12T00:00:00.000Z";
export const NOW = Date.parse(GEN);

export function sample(over: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
  return {
    generatedAt: GEN,
    groups: [
      { id: 1, name: "우리 둘", color: 0, code: "team1xxx" },
      { id: 2, name: "가족", color: 3, code: "team2xxx" },
    ],
    days: Array.from({ length: 7 }, (_, i) => ({
      date: addDays("2026-11-12", i),
      events:
        i === 0
          ? [
              { g: 1, title: "저녁 약속", time: "19:00" },
              { g: 2, title: "엄마 생신", time: "종일" },
            ]
          : [],
      total: i === 0 ? 5 : 0,
    })),
    anniversaries: [
      { g: 1, title: "처음 만난 날 300일", date: "2026-11-24" },
      { g: 2, title: "결혼기념일", date: "2027-01-02" },
    ],
    ...over,
  };
}
