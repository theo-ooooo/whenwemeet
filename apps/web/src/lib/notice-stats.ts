// (#544) 관리자 공지 결과 칸의 숫자와 문구 (D-293). 화면(AdminNoticeResults)은 이 결과를 그리기만 한다
import { readRateText } from "./notice";
import type { NoticeStats } from "./types";

export type NoticeStatTile = {
  label: string;
  /** 그대로 그리는 값 ("12", "67%", "-") */
  value: string;
  hint?: string;
  /** 실패처럼 눈에 띄어야 하는 값 */
  warn?: boolean;
};

const n = (v: number) => v.toLocaleString("ko-KR");

/** 푸시 상태 한 줄. 보낸 뒤 결과가 쌓이는 중이면 그 사실을, 보내지 않았으면 그 사실을 */
export function noticePushNote(stats: NoticeStats): string | null {
  const push = stats.push;
  if (!push) return "푸시를 보내지 않은 공지예요. 읽은 비율은 전체 사용자 기준이에요";
  if (push.status === "PENDING") return "푸시를 보낼 준비 중이에요. 곧 대상과 결과가 채워져요";
  if (push.status === "SKIPPED" || push.status === "CANCELLED") return "푸시를 보내지 못했어요 (게시를 취소했거나 너무 늦어 건너뛰었어요)";
  if (push.pending > 0) return `기기 ${n(push.pending)}대는 아직 결과를 기다리고 있어요`;
  return null;
}

/** 결과 칸 여섯: 푸시 대상, 전달 성공, 실패, 읽음, 푸시로 연 사람, 읽은 비율 */
export function noticeStatTiles(stats: NoticeStats): NoticeStatTile[] {
  const push = stats.push;
  const basis = stats.readRateBasis;
  return [
    { label: "푸시 대상", value: push ? n(push.targetUsers) : "-", hint: push ? `기기 ${n(push.devices)}대` : "보내지 않음" },
    { label: "전달 성공", value: push ? n(push.delivered) : "-", hint: push ? `보낸 기기 ${n(push.sent)}대` : undefined },
    { label: "실패", value: push ? n(push.failed) : "-", hint: push ? "보내기 실패, 영수증 오류" : undefined, warn: Boolean(push && push.failed > 0) },
    { label: "읽음", value: n(stats.reads.total), hint: "로그인한 사람만" },
    { label: "푸시로 연 사람", value: n(stats.reads.pushOpened) },
    {
      label: "읽은 비율",
      value: readRateText(stats.readRate),
      hint: basis.of === "push" ? `푸시 대상 ${n(basis.total)}명 중 ${n(basis.read)}명` : `전체 ${n(basis.total)}명 중 ${n(basis.read)}명`,
    },
  ];
}

/** 푸시 대상 중 안 읽은 사람 수. 푸시를 보내지 않았으면 null (필터를 그리지 않는다) */
export function unreadTargetCount(stats: NoticeStats): number | null {
  if (!stats.push || stats.readRateBasis.of !== "push") return null;
  return Math.max(0, stats.readRateBasis.total - stats.readRateBasis.read);
}
