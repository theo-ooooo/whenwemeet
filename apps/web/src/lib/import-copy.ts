// (#279) 일정 가져오기 화면의 문구 (설계 `일정-가져오기.md` 5장). 순수 함수 (단위 테스트 대상)
import { formatDateKo, dateKeyOf, todayKey } from "./date";
import type { ImportPreview, ImportSkipReason } from "./types";

/** 파일 크기 상한 (API 와 같다). 넘으면 올리기 전에 막는다 */
export const ICS_MAX_BYTES = 2 * 1024 * 1024;

/** 건너뛴 이유별 줄 */
export const SKIP_LABEL: Record<ImportSkipReason, string> = {
  DUPLICATE: "이미 넣은 일정",
  CANCELLED: "취소된 일정",
  TOO_OLD: "기간보다 지난 일정",
  TOO_LONG: "30일보다 길거나 반복 간격보다 긴 일정",
  INVALID: "읽을 수 없는 일정",
  OVER_LIMIT: "한 번에 1,000개를 넘는 일정",
};

const n = (count: number) => count.toLocaleString("en-US");

/** 큰 제목. "42개를 넣어요", 0 이면 "넣을 일정이 없어요" */
export function previewHeadline(preview: Pick<ImportPreview, "toCreate">): string {
  return preview.toCreate > 0 ? `${n(preview.toCreate)}개를 넣어요` : "넣을 일정이 없어요";
}

/** 제목 아래 줄들: 반복 유지, 나눠 넣음, 기간 */
export function previewLines(preview: ImportPreview, today = todayKey()): string[] {
  const lines: string[] = [];
  if (preview.recurringKept > 0) lines.push(`반복 일정 ${n(preview.recurringKept)}개는 반복 그대로 넣어요`);
  if (preview.expanded > 0) {
    lines.push(`반복 규칙을 옮길 수 없는 일정 ${n(preview.expandedSeries)}개는 1년 안 회차 ${n(preview.expanded)}개로 나눠 넣어요`);
  }
  if (preview.firstStartsAt && preview.lastStartsAt) {
    const first = dateKeyOf(preview.firstStartsAt);
    const last = dateKeyOf(preview.lastStartsAt);
    const withYear = first.slice(0, 4) !== today.slice(0, 4) || last.slice(0, 4) !== today.slice(0, 4);
    lines.push(first === last ? `${formatDateKo(first, withYear)} 일정` : `${formatDateKo(first, withYear)} ~ ${formatDateKo(last, withYear)}`);
  }
  return lines;
}

/** 경고 줄 */
export function warningLines(preview: Pick<ImportPreview, "warnings">): string[] {
  return preview.warnings.map((warning) =>
    warning === "UNKNOWN_TZID" ? "시간대를 알 수 없는 일정은 한국 시간으로 넣어요" : "50자가 넘는 제목은 잘라서 넣어요",
  );
}

/** 완료 제목 */
export function doneHeadline(created: number): string {
  return created > 0 ? `${n(created)}개를 넣었어요` : "새로 넣은 일정이 없어요";
}

/** 고른 파일이 .ics 처럼 보이는지. 앱 웹뷰는 accept 를 넓혀 아무 파일이나 고를 수 있어 이름과 형식으로 한 번 거른다 */
export function looksLikeIcs(file: { name: string; type: string }): boolean {
  return /\.ics$/i.test(file.name) || file.type === "text/calendar";
}
