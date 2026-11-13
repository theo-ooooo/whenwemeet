"use client";
// (#203) 브라우저 오프라인 안내 (D-256). 서비스 워커가 문서 이동에 실패하면 캐시해 둔 /offline 을 원래 주소에 그대로 보여 준다.
// 그래서 [다시 시도] 는 지금 주소를 다시 연다. 연결이 돌아오면(online 이벤트) 저절로 다시 연다.
// 쿠키, API 를 쓰지 않는다. 문구는 앱 셸 OfflineScreen(#270)과 같다. 모양은 점검 화면(MaintenanceScreen)과 같다
import { useEffect } from "react";
import { Symbol } from "./Logo";
import { Button } from "./ui";

function retry() {
  // /offline 을 직접 연 경우에는 홈으로 (같은 안내를 다시 그리지 않게)
  if (window.location.pathname === "/offline") window.location.replace(new URL("/", window.location.origin).href);
  else window.location.reload();
}

export function OfflineScreen() {
  useEffect(() => {
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  return (
    <div className="min-h-dvh bg-[var(--login-bg)]">
      <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
        <Symbol size={40} />
        <div role="alert" className="mt-auto pt-16">
          <span className="inline-flex text-[13px] font-bold text-acc-ink">오프라인</span>
          <h1 className="mt-2 text-[32px] font-bold leading-[1.15] tracking-[-0.03em]">
            인터넷에 연결되어
            <br />
            있지 않아요
          </h1>
          <p className="mt-3 text-[15px] leading-[22px] text-soft">
            인터넷 연결을 확인해 주세요
            <br />
            연결되면 보던 화면을 다시 열어요
          </p>
        </div>
        <div className="mt-8">
          <Button size="lg" full onClick={retry}>
            다시 시도
          </Button>
        </div>
      </main>
    </div>
  );
}
