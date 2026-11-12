// 사이트 공통 메타 (#154). 루트 레이아웃과 페이지별 generateMetadata 가 같이 쓴다.
// 이미지는 route handler(app/og/route.tsx, app/og/join/[code]/route.tsx, app/og/join/e/[token]/route.tsx)가 그린다 (#159, #274). 주소는 여기서 metadata 에 직접 단다 (#204)
export const SITE_URL = "https://whenwemeet.day";
export const SITE_NAME = "언제볼까";
export const SITE_TITLE = "언제볼까 - 같이 쓰는 달력";
export const SITE_DESCRIPTION = "언제 볼까? 를 달력 하나로. 함께 쓰는 공유 일정";

// 공유 미리보기 이미지 (#204). 상대 주소는 루트 layout 의 metadataBase(SITE_URL) 로 절대 주소가 된다
const OG_IMAGE_BASE = { width: 1200, height: 630, type: "image/png" } as const;

/** 사이트 기본 카드 (모든 화면) */
export const SITE_OG_IMAGE = { ...OG_IMAGE_BASE, url: "/og", alt: SITE_TITLE };

/** 초대 카드. 코드가 없거나 API 가 안 되면 route 가 일반 초대 카드를 그린다. (#196) by 가 있으면 보낸 사람 이름을 그린다 */
export function inviteOgImage(code: string, by: string | null = null) {
  const query = by ? `?by=${by}` : "";
  return { ...OG_IMAGE_BASE, url: `/og/join/${encodeURIComponent(code)}${query}`, alt: "언제볼까 팀 초대" };
}

/** (#274) 일정 카드. 토큰이 틀리거나 링크가 끝났으면 route 가 일반 일정 카드를 그린다 */
export function eventShareOgImage(token: string) {
  return { ...OG_IMAGE_BASE, url: `/og/join/e/${encodeURIComponent(token)}`, alt: "언제볼까 일정 공유" };
}
