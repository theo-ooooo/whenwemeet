// 초대 미리보기 이미지가 쓰는 공개 API 조회 (#159). 화면(serverApi)과 달리 점검 화면으로 보내지 않고, 실패하면 null(일반 카드)
// 스크래퍼는 몇 초 안에 응답을 못 받으면 이미지를 버리므로 짧게 끊는다
import { readEnvelope } from "@/lib/envelope";
import { invitePreviewPath } from "@/lib/invite-share";
import type { InvitePreview } from "@/lib/types";
import { apiUrl, internalHeaders, isMock, upstream } from "@/lib/upstream";

const TIMEOUT_MS = 2500;
/** 팀 이름, 멤버 수가 바뀌어도 5분 안에 새 이미지 */
export const INVITE_OG_REVALIDATE = 300;

/** (#196) by 는 parseInviteBy 를 거친 값. 표식이 다르면 URL 이 달라 캐시도 따로 (D-159) */
export async function loadInviteForOg(code: string, by: string | null = null): Promise<InvitePreview | null> {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return null;
  const path = invitePreviewPath(code, by);
  try {
    if (isMock()) {
      const [p, q] = path.split("?");
      const res = await upstream({ method: "GET", path: p, search: q ? `?${q}` : "", token: null });
      const env = readEnvelope<InvitePreview>(res.status, res.body);
      return env.ok ? (env.data ?? null) : null;
    }
    const res = await fetch(`${apiUrl()}/v1${path}`, {
      // (#186) 캐시된 결과를 여러 사람이 보므로 사용자 IP 없이 내부 키만. API 는 웹 서버 묶음("internal")으로 센다
      headers: { Accept: "application/json", ...internalHeaders(null) },
      next: { revalidate: INVITE_OG_REVALIDATE },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const env = readEnvelope<InvitePreview>(res.status, await res.json().catch(() => null));
    return env.ok && env.data?.groupName ? env.data : null;
  } catch {
    return null;
  }
}
