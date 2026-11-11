"use client";
// 루트 레이아웃까지 깨졌을 때(#54). 레이아웃을 대신하므로 html, body, 전역 CSS, 테마 스크립트를 직접 싣는다
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { shouldReportBoundaryError } from "@/lib/sentry";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // (#185) 브라우저에서 난 렌더 오류만. 서버 오류(digest 있음)는 instrumentation 의 onRequestError 가 보냈다
    if (shouldReportBoundaryError(error)) Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <title>점검 중 | 언제볼까</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-dvh">
        <MaintenanceScreen />
      </body>
    </html>
  );
}
