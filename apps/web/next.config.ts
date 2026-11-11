import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // (#185) 브라우저 Sentry 의 환경, 릴리스. 빌드 때 값을 박는다 (DSN 은 NEXT_PUBLIC_SENTRY_DSN 으로 따로)
  env: {
    SENTRY_CLIENT_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV || "",
    SENTRY_CLIENT_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA || "",
  },
  agentRules: false,
  // 공유 미리보기 이미지(#159)가 fs 로 읽는 Pretendard OTF 를 함수 번들에 넣는다
  outputFileTracingIncludes: {
    "/**/opengraph-image*": ["./src/app/_og/fonts/*.otf"],
    "/**/twitter-image*": ["./src/app/_og/fonts/*.otf"],
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
