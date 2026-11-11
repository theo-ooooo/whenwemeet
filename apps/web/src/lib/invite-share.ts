// (#196) 초대 링크 공유의 한 곳. 팀 설정의 [링크 복사], OS 공유, 앱 공유 브리지가 모두 여기서 주소와 문구를 받는다.
// 카카오톡 공유 템플릿(#195)과 일정 카드 공유(#274)도 같은 주소(보낸 사람 표식 `?by=` 가 붙은)를 쓴다 (D-157, D-159)
import type { GroupDetail } from "./types";

/** API 표식 모양 (base64url 10자). 다른 값은 버리고 표식 없이 미리보기를 부른다 */
const INVITE_BY_PATTERN = /^[A-Za-z0-9_-]{10}$/;

export const INVITE_SHARE_TITLE = "언제볼까 초대";

export type InviteShare = {
  /** 보낼 주소. 서버가 만든 inviteShareUrl(내 표식 포함), 없으면 inviteUrl */
  url: string;
  /** 공유 본문 (주소 제외). 앱 공유 브리지는 주소를 셸이 붙인다 */
  message: string;
  /** 본문 + 줄바꿈 + 주소 (Web Share 의 text) */
  text: string;
  title: string;
};

export function inviteShare(group: Pick<GroupDetail, "name" | "inviteUrl" | "inviteShareUrl">): InviteShare {
  const url = group.inviteShareUrl ?? group.inviteUrl ?? "";
  // 카카오, Apple, 이메일 어느 것으로든 로그인하면 합류된다 (D-159)
  const message = `'${group.name}' 달력에 초대할게요. 링크를 열고 로그인하면 바로 합류돼요`;
  return { url, message, text: `${message}\n${url}`, title: INVITE_SHARE_TITLE };
}

/** 쿼리의 by. 하나의 문자열이고 표식 모양일 때만, 아니면 null */
export function parseInviteBy(raw: string | string[] | null | undefined): string | null {
  return typeof raw === "string" && INVITE_BY_PATTERN.test(raw) ? raw : null;
}

/** `/invites/<code>` (+ `?by=`) 미리보기 경로 */
export function invitePreviewPath(code: string, by: string | null): string {
  return `/invites/${encodeURIComponent(code)}${by ? `?by=${by}` : ""}`;
}
