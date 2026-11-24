import { ok, type GroupReq, type MockResult } from "./shared";

  // (#279) 일정 가져오기. 목은 파일을 읽지 않고 고정된 미리보기와 결과만 준다 (화면 확인용)
export function importsRoute(req: GroupReq): MockResult | null {
  const { method, rest } = req;
  if (rest[0] === "imports" && method === "POST") {
    const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    if (rest[1] === "preview") {
      return ok({
        total: 9,
        toCreate: 14,
        recurringKept: 2,
        expanded: 11,
        expandedSeries: 3,
        skipped: [
          { reason: "CANCELLED", count: 1 },
          { reason: "TOO_OLD", count: 1 },
        ],
        firstStartsAt: at(1),
        lastStartsAt: at(200),
        warnings: [],
        sample: [
          { title: "영어 스터디", startsAt: at(2), endsAt: at(2.05), allDay: false, repeat: "WEEKLY" },
          { title: "치과", startsAt: at(3), endsAt: at(3.05), allDay: false, repeat: null },
        ],
        // (#314) 넣을 일정 전부. key 는 64자 hex 모양만 맞춘다
        items: Array.from({ length: 14 }, (_, i) => {
          const day = 1 + i * 15;
          return {
            key: i.toString(16).padStart(64, "0"),
            title: i === 0 ? "영어 스터디" : `가져온 일정 ${i + 1}`,
            startsAt: at(day),
            endsAt: at(i % 3 === 0 ? day + 2 : day + 0.05),
            allDay: i % 3 === 0,
            repeat: i === 0 ? "WEEKLY" : null,
          };
        }),
      });
    }
    return ok({ importId: 1, created: 14, skipped: [{ reason: "CANCELLED", count: 1 }] }, 201);
  }
  return null;
}
