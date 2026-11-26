"use client";
// (#539) 앱 업데이트 안내 (D-292). 앱 셸 안(UA 에 WhenwemeetApp/<버전> (ios|android))에서만, 웹 브라우저는 아무것도 안 한다.
// 기종의 최신, 최소 버전을 받아 지금 버전과 비교한다:
//   최소 버전보다 낮음 → 닫을 수 없는 "업데이트가 필요해요" 창 + 스토어 버튼 (다른 창보다 위, z 60)
//   최신 버전보다 낮음 → 본문 위 한 줄 "새 버전이 나왔어요 · 업데이트 ›" + ×. 닫으면 그 최신 버전 동안 이 기기에서 다시 안 보인다
// 스토어 주소는 웹뷰 바깥 주소라 셸이 시스템(App Store, Play 스토어)으로 연다 (앱.md 4.4). 셸은 바꿀 필요 없다
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { useAppRelease } from "@/hooks";
import { parseAppUserAgent } from "@/lib/app-bridge";
import { appUpdateHintKey, appUpdateStatus, storeName, type AppUpdateStatus } from "@/lib/app-version";
import { dismissHint, useHintDismissed } from "@/lib/hint";
import type { AppRelease } from "@/lib/types";
import { IconChevronRight, IconClose, IconSparkle } from "./icons";

const noSubscribe = () => () => {};

/** 지금 앱 버전과 안내 상태. 앱이 아니면 status null */
export function useAppUpdate(): { status: AppUpdateStatus; release: AppRelease | null; version: string | null } {
  // UA 는 바뀌지 않으므로 구독 없이 브라우저 값만 읽는다 (서버 렌더는 앱 아님)
  const ua = useSyncExternalStore(
    noSubscribe,
    () => navigator.userAgent,
    () => "",
  );
  const app = parseAppUserAgent(ua);
  const release = useAppRelease(app?.os ?? null).data;
  const status = app && release ? appUpdateStatus(app.version, release) : null;
  return { status, release: release ?? null, version: app?.version ?? null };
}

/** 최신 버전보다 낮을 때 본문 위 한 줄. 최신 버전마다 한 번 닫을 수 있다 */
export function AppUpdateBanner({ release }: { release: AppRelease }) {
  const key = appUpdateHintKey(release.latestVersion ?? "");
  const dismissed = useHintDismissed(key);
  if (dismissed || !release.latestVersion) return null;
  return (
    <div className="mb-3 flex h-11 items-center gap-2 rounded-xl bg-paper pl-3.5 pr-2 text-[13px] fold:mb-4">
      <IconSparkle size={16} className="shrink-0 text-acc-ink" />
      <a href={release.storeUrl} className="group flex h-11 min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate font-semibold text-ink">새 버전이 나왔어요</span>
        <span className="flex shrink-0 items-center gap-0.5 font-medium text-acc-ink group-hover:underline group-hover:underline-offset-2">
          업데이트
          <IconChevronRight size={14} />
        </span>
      </a>
      <button
        type="button"
        onClick={() => dismissHint(key)}
        aria-label="새 버전 안내 닫기"
        className="hit grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}

/** 최소 버전보다 낮을 때 닫을 수 없는 창 */
export function AppUpdateRequired({ release, version }: { release: AppRelease; version: string | null }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    panel.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center lg:items-center">
      <div aria-hidden="true" className="anim-fade absolute inset-0 bg-[var(--scrim)]" />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative w-full fold:max-w-[480px] rounded-t-2xl bg-paper px-6 pb-[calc(24px+var(--sab))] pt-8 text-center outline-none lg:max-w-[400px] lg:rounded-2xl lg:border lg:border-line lg:pb-6 lg:shadow-[var(--pop-shadow)]"
      >
        <span
          aria-hidden="true"
          className="mx-auto grid size-14 place-items-center rounded-2xl text-acc-ink"
          style={{ background: "color-mix(in srgb, var(--pri) 12%, transparent)" }}
        >
          <IconSparkle size={28} />
        </span>
        <h2 id={titleId} className="mt-4 text-[20px] font-bold leading-7 tracking-[-0.02em]">
          업데이트가 필요해요
        </h2>
        <p className="mt-1.5 break-keep text-[15px] leading-6 text-soft">
          {version ? `지금 쓰는 버전(${version})은` : "지금 쓰는 버전은"} 더 이상 지원하지 않아요. {storeName(release.platform)}에서 새 버전으로 업데이트해
          주세요.
        </p>
        <a
          href={release.storeUrl}
          className="mt-6 flex h-12 w-full items-center justify-center rounded-md bg-btn px-5 text-[15px] font-bold text-on-btn hover:brightness-95"
        >
          {storeName(release.platform)}에서 업데이트
        </a>
      </div>
    </div>
  );
}
