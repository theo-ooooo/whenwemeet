// (#536) 신고하기 표기 (D-289). 단위 테스트 대상이라 React 를 import 하지 않는다
import type { ReportReason, ReportTargetType } from "./types";

/** 사유 순서와 이름 (신고 시트의 고르기, 관리자 화면 공통) */
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "스팸, 광고" },
  { value: "abuse", label: "욕설, 괴롭힘" },
  { value: "illegal", label: "불법 정보" },
  { value: "privacy", label: "개인정보 노출" },
  { value: "other", label: "그 밖의 이유" },
];

export function reportReasonLabel(reason: string): string {
  return REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

/** 자세한 내용 상한 (API 와 같다) */
export const REPORT_DETAIL_MAX = 500;

/** 신고 시트 제목: "일정 신고", "팀 신고", "{이름} 신고" */
export function reportSheetTitle(targetType: ReportTargetType, name?: string): string {
  if (targetType === "event") return "일정 신고";
  if (targetType === "group") return "팀 신고";
  return name ? `${name} 신고` : "사용자 신고";
}

/** 신고 성공 안내. 접수 중인 같은 신고가 있었으면(duplicate) 그 사실을 말한다 */
export function reportDoneText(duplicate: boolean): string {
  return duplicate ? "이미 신고했어요. 확인 후 조치할게요" : "신고했어요. 확인 후 조치할게요";
}
