"use client";
// 렌더 중 예외(서버 컴포넌트 포함) 시 점검 화면을 그 자리에 그린다 (#54). [다시 시도] 와 자동 복귀는 지금 경로를 다시 연다
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { shouldReportBoundaryError } from "@/lib/sentry";

export default function RouteError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // (#185) 브라우저에서 난 렌더 오류만. 서버 오류(digest 있음)는 instrumentation 의 onRequestError 가 보냈다
    if (shouldReportBoundaryError(error)) Sentry.captureException(error);
  }, [error]);
  return <MaintenanceScreen />;
}
