import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  devIndicators: false,
  // (#185) 브라우저 Sentry 의 환경, 릴리스. 빌드 때 값을 박는다 (DSN 은 NEXT_PUBLIC_SENTRY_DSN 으로 따로)
  env: {
    SENTRY_CLIENT_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV || "",
    SENTRY_CLIENT_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA || "",
    // (#333) 내 정보 맨 아래 버전 한 줄. 웹 버전은 package.json(release PR 이 올린다), 커밋은 Vercel 빌드에만 있다
    NEXT_PUBLIC_WEB_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "",
    // (#203) 서비스 워커 캐시 이름(/sw.js?v=). 빌드마다 달라야 새 배포에서 옛 캐시를 지운다 (D-256)
    NEXT_PUBLIC_SW_VERSION: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || `${pkg.version}-${Date.now().toString(36)}`,
  },
  agentRules: false,
  experimental: {
    // (#339) 한 번 받은 팀 화면(RSC)은 30초 동안 다시 받지 않는다. 기본 0 이면 같은 탭을 다시 눌러도 매번 서버(sin1)를 왕복했다.
    // 화면 데이터는 클라이언트 훅이 따로 받으므로 오래된 RSC 를 써도 보이는 값은 낡지 않는다
    staleTimes: { dynamic: 30 },
  },
  // 공유 미리보기 이미지(#159)가 fs 로 읽는 Pretendard OTF 를 그 route 함수에만 넣는다 (#204: app/og 로 옮김)
  outputFileTracingIncludes: {
    "/og": ["./src/app/_og/fonts/*.otf"],
    "/og/**/*": ["./src/app/_og/fonts/*.otf"],
  },
  // (#204) 옛 메타데이터 이미지 주소(이미 공유된 카드의 캐시된 HTML 이 가리킬 수 있음)를 새 route 로 보낸다
  async redirects() {
    return [
      { source: "/opengraph-image", destination: "/og", permanent: true },
      { source: "/twitter-image", destination: "/og", permanent: true },
      { source: "/join/:code/opengraph-image", destination: "/og/join/:code", permanent: true },
      { source: "/join/:code/twitter-image", destination: "/og/join/:code", permanent: true },
    ];
  },
  // (#274) 일정 공유 링크 화면은 토큰이 밖 링크의 Referer 로 새지 않게 (D-186)
  async headers() {
    // (#203) 서비스 워커와 규칙 파일은 늘 새로 확인한다 (D-256). 루트 scope 라 Service-Worker-Allowed 는 필요 없다
    const swHeaders = [
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
    ];
    return [
      { source: "/join/e/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/sw.js", headers: swHeaders },
      { source: "/sw-rules.js", headers: swHeaders },
    ];
  },
  // 모든 화면이 사용자별(쿠키) 데이터라 캐시 컴포넌트는 쓰지 않는다
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
