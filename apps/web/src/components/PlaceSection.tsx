"use client";
// (#199) 일정 상세의 장소 칸 (D-244). 이름 15/600 + 주소, 좌표가 있으면 작은 지도(누르면 크게, 끌고 확대 가능),
// 보조 버튼 하나 "카카오맵으로 길찾기"(https 웹 주소. 앱 셸이 OS 로 넘겨 카카오맵 앱이나 브라우저가 연다).
// 지도를 못 그리면(키 없음, SDK 실패) 글자와 길찾기 버튼만 남는다. 기기 위치는 쓰지 않는다
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { directionsUrl, hasCoords } from "@/lib/place";
import type { Place } from "@/lib/types";
import { useInApp } from "@/lib/useInApp";
import { IconExpand, IconPin } from "./icons";
import { canShowMap, PlaceMap } from "./PlaceMap";
import { CloseButton } from "./ui";

export function PlaceSection({ place }: { place: Place | null | undefined }) {
  const titleId = useId();
  const [mapFailed, setMapFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const onFail = useCallback(() => setMapFailed(true), []);
  if (!place) return null;
  const showMap = hasCoords(place) && canShowMap() && !mapFailed;
  const address = place.address && place.address !== place.name ? place.address : null;
  return (
    <section aria-labelledby={titleId} className="mt-2.5 rounded-sm bg-surface px-3.5 py-3">
      <h3 id={titleId} className="text-[12px] font-semibold leading-4 text-ink-2">
        장소
      </h3>
      <div className="mt-1.5 flex items-start gap-2">
        <IconPin size={18} active={hasCoords(place)} className="mt-0.5 shrink-0 text-ink-2" />
        <div className="min-w-0">
          <p className="break-words text-[15px] font-semibold leading-6 text-ink">{place.name}</p>
          {address && <p className="break-words text-[13px] leading-[18px] text-soft">{address}</p>}
        </div>
      </div>
      {showMap && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-haspopup="dialog"
          className="group relative mt-2.5 block h-36 w-full overflow-hidden rounded-sm border border-line"
        >
          <PlaceMap lat={place.lat as number} lng={place.lng as number} label={`${place.name} 위치 지도`} className="absolute inset-0" onFail={onFail} />
          {/* 미리보기 지도는 끌리지 않는다. 누르면 크게 */}
          <span className="absolute bottom-2 right-2 flex h-8 items-center gap-1 rounded-full bg-paper/95 px-2.5 text-[12px] font-semibold text-ink shadow-[0_1px_3px_rgba(0,0,0,0.15)]">
            <IconExpand size={14} />
            크게 보기
          </span>
        </button>
      )}
      <DirectionsLink place={place} className="mt-2.5" />
      {expanded && showMap && <MapSheet place={place} onClose={() => setExpanded(false)} />}
    </section>
  );
}

/** "카카오맵으로 길찾기" 보조 버튼 (면 --hover, 13.5/700). 앱 셸은 target 없이(셸이 OS 로), 브라우저는 새 탭 */
function DirectionsLink({ place, className = "" }: { place: Place; className?: string }) {
  const inApp = useInApp();
  return (
    <a
      href={directionsUrl(place)}
      {...(inApp ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      className={`flex h-10 w-full items-center justify-center rounded-md bg-hover text-[13.5px] font-bold text-ink hover:brightness-95 ${className}`}
    >
      카카오맵으로 길찾기
    </a>
  );
}

/** 지도 크게 보기. 폰은 화면 전체, 넓은 화면은 가운데 창(720 × 560). 끌기, 확대 가능 */
function MapSheet({ place, onClose }: { place: Place; onClose: () => void }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 일정 상세 창의 Esc 처리보다 먼저 받아 지도만 닫는다 (캡처 단계에서 멈춘다)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  const address = place.address && place.address !== place.name ? place.address : null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center fold:items-center fold:p-6">
      <button type="button" aria-label="닫기" tabIndex={-1} onClick={onClose} className="anim-fade absolute inset-0 hidden bg-[var(--scrim)] fold:block" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative flex h-full w-full flex-col bg-paper outline-none fold:h-[min(560px,90dvh)] fold:max-w-[720px] fold:overflow-hidden fold:rounded-lg fold:border fold:border-line fold:shadow-[var(--pop-shadow)]"
      >
        <div className="flex h-[calc(52px+env(safe-area-inset-top))] shrink-0 items-center gap-2 px-4 pt-[env(safe-area-inset-top)] fold:h-14 fold:pt-0">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-[18px] font-bold leading-6 tracking-[-0.02em]">
            {place.name}
          </h2>
          <CloseButton onClick={onClose} className="shrink-0" />
        </div>
        <PlaceMap lat={place.lat as number} lng={place.lng as number} interactive level={3} label={`${place.name} 위치 지도, 끌어서 옮기고 확대할 수 있어요`} className="min-h-0 flex-1" />
        <div className="shrink-0 border-t border-line px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 fold:pb-4">
          {address && <p className="mb-2 break-words text-[13px] leading-[18px] text-soft">{address}</p>}
          <DirectionsLink place={place} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
