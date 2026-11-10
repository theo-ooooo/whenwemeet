// 사이트 공통 메타 (#154). 루트 레이아웃과 페이지별 generateMetadata 가 같이 쓴다.
// Next 는 하위 페이지의 openGraph, twitter 를 부모와 합치지 않고 통째로 바꾸므로 이미지를 페이지마다 다시 넣는다
export const SITE_URL = "https://whenwemeet.day";
export const SITE_NAME = "언제볼까";
export const SITE_TITLE = "언제볼까 - 같이 쓰는 달력";
export const SITE_DESCRIPTION = "언제 볼까? 를 달력 하나로. 함께 쓰는 공유 일정";
// 1200x630 정적 PNG: scripts/gen-og.mjs 로 생성. 카카오는 미리보기를 캐시한다 (docs/운영/vercel.md 공유 미리보기)
export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: SITE_TITLE };
