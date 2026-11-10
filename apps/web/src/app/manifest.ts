import type { MetadataRoute } from "next";

// Web App Manifest (#85 P0). /manifest.webmanifest 로 서빙되고 layout 에 <link rel="manifest"> 가 자동으로 붙는다.
// 색은 디자인토큰 라이트 --bg. manifest 는 다크 값을 따로 못 가지므로 브라우저 안 상단 색은 layout viewport.themeColor(라이트/다크)가 맡는다.
// 아이콘은 scripts/gen-icons.mjs 로 생성한다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "언제볼까",
    short_name: "언제볼까",
    description: "언제 볼까? 를 달력 하나로. 함께 쓰는 공유 일정",
    lang: "ko",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#F4F3F1",
    background_color: "#F4F3F1",
    categories: ["productivity", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
