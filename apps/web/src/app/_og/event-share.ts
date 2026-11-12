// (#274) 일정 카드 이미지가 쓰는 공개 미리보기 조회. 초대 카드(_og/invite.ts)와 같은 규칙: 실패하면 null(일반 카드), 짧게 끊고 5분 캐시
// 초대 로더는 코드를 대문자로 바꾸므로 그대로 쓰지 않는다 (토큰은 대소문자 구분)
import { readEnvelope } from "@/lib/envelope";
import { eventSharePreviewPath, parseEventShareToken } from "@/lib/event-share";
import type { EventSharePreview } from "@/lib/types";
import { apiUrl, internalHeaders, isMock, upstream } from "@/lib/upstream";
import { INVITE_OG_REVALIDATE } from "./invite";

const TIMEOUT_MS = 2500;

export async function loadEventShareForOg(raw: string): Promise<EventSharePreview | null> {
  const token = parseEventShareToken(raw);
  if (!token) return null;
  const path = eventSharePreviewPath(token);
  try {
    if (isMock()) {
      const res = await upstream({ method: "GET", path, search: "", token: null });
      const env = readEnvelope<EventSharePreview>(res.status, res.body);
      return env.ok ? (env.data ?? null) : null;
    }
    const res = await fetch(`${apiUrl()}/v1${path}`, {
      // 캐시된 카드를 여러 사람이 보므로 사용자 토큰, IP 없이 내부 키만 ("internal" 묶음, #186)
      headers: { Accept: "application/json", ...internalHeaders(null) },
      next: { revalidate: INVITE_OG_REVALIDATE },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const env = readEnvelope<EventSharePreview>(res.status, await res.json().catch(() => null));
    return env.ok && env.data?.event?.title ? env.data : null;
  } catch {
    return null;
  }
}
