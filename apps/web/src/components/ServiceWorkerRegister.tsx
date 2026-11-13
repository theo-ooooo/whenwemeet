"use client";
// (#203) 브라우저에서만 서비스 워커를 등록한다 (D-256). 앱 셸 UA 면 등록하지 않고 남은 등록과 캐시를 지운다
import { useEffect } from "react";
import { serviceWorkerAction, serviceWorkerUrl } from "@/lib/service-worker";

const CACHE_PREFIX = "wwm-static-";

async function unregisterAll(): Promise<void> {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n)));
  }
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    const action = serviceWorkerAction({
      ua: navigator.userAgent,
      supported: "serviceWorker" in navigator,
      secure: window.isSecureContext,
      production: process.env.NODE_ENV === "production",
    });
    if (action === "unregister") {
      unregisterAll().catch(() => {});
    } else if (action === "register") {
      navigator.serviceWorker
        .register(serviceWorkerUrl(process.env.NEXT_PUBLIC_SW_VERSION), { scope: "/", updateViaCache: "none" })
        .catch(() => {
          // 등록 실패는 화면 동작에 영향이 없다 (오프라인 안내만 빠진다)
        });
    }
  }, []);
  return null;
}
