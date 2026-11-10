"use client";
// '점검 중이에요' 화면 (#54). /maintenance, app/error.tsx, app/global-error.tsx 가 함께 쓴다.
// API 는 부르지 않고 30초마다 /api/health 만 확인해 정상이면 from 으로 돌아간다 (무한 이동 방지).
// from 이 없으면(error.tsx, global-error.tsx) 지금 경로를 다시 연다.
import { useEffect } from "react";
import { Symbol } from "./Logo";
import { Button } from "./ui";
import { useHealth } from "@/hooks";
import { safeFrom } from "@/lib/maintenance";

const HEALTH_INTERVAL_MS = 30_000;

function target(from: string | undefined): string {
  if (from !== undefined) return safeFrom(from);
  return window.location.pathname + window.location.search;
}

export function MaintenanceScreen({ from }: { from?: string }) {
  const { data } = useHealth({ intervalMs: HEALTH_INTERVAL_MS });

  // 서버가 돌아오면 원래 화면으로. 서버 컴포넌트까지 다시 그리도록 전체 이동
  useEffect(() => {
    if (data?.ok) window.location.assign(target(from));
  }, [data, from]);

  return (
    <div className="min-h-dvh bg-[var(--login-bg)]">
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
        <Symbol size={40} />
        <div role="alert" className="mt-auto pt-16">
          <span className="inline-flex text-[13px] font-bold text-acc-ink">
            서버 점검
          </span>
          <h1 className="mt-2 text-[32px] font-bold leading-[1.15] tracking-[-0.03em]">점검 중이에요</h1>
          <p className="mt-3 text-[15px] leading-[22px] text-soft">
            잠시 후 다시 시도해 주세요
            <br />
            서버가 돌아오면 원래 화면으로 자동으로 이동해요
          </p>
        </div>
        <div className="mt-8">
          <Button size="lg" full onClick={() => window.location.assign(target(from))}>
            다시 시도
          </Button>
        </div>
      </main>
    </div>
  );
}
