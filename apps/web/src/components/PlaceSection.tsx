"use client";
// (#199) 일정 상세의 장소 칸 (D-242, D-244, D-259). 고른 장소는 저장된 식별자(카카오 ID, 네이버 키) + 검색어로 고른 출처에서 지금 다시 찾아
// (usePlaceResolve, 메모리 캐시만) 이름 15/600 + 주소 + 작은 지도(누르면 크게, 끌고 확대 가능) + 보조 버튼 하나 "네이버 지도로 길찾기".
// 지도와 길찾기는 내 정보의 지도 선택(기본 네이버 지도, 카카오맵으로 바꿀 수 있다)을 따른다. 좌표는 출처와 상관없이 고른 지도에 그린다.
// 못 찾으면(검색 오류, 결과에서 사라짐) 사용자 글자 + "네이버 지도에서 보기"(카카오맵이면 카카오 ID 장소 상세, 없으면 글자 검색), 지도 없음.
// 직접 적은 장소는 글자 + 이름 검색 링크. 지도를 못 그리면(키 없음, SDK 실패, 인증 실패) 글자와 링크만 남는다. 기기 위치는 쓰지 않는다
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlaceResolve } from "@/hooks";
import { directionsLabel } from "@/lib/map-app";
import { directionsUrl, placeLabel, placeRef } from "@/lib/place";
import type { MapApp } from "@/lib/map-app";
import { useMapApp } from "@/lib/useMapApp";
import type { Place, PlaceCandidate } from "@/lib/types";
import { useInApp } from "@/lib/useInApp";
import { IconExpand, IconPin } from "./icons";
import { canShowMap, PlaceMap } from "./PlaceMap";
import { CloseButton, Skeleton } from "./ui";

export function PlaceSection({ place }: { place: Place | null | undefined }) {
  const titleId = useId();
  const [app] = useMapApp();
  // 그 지도(SDK)가 실패했는지. 지도 선택을 바꾸면 다른 SDK 로 다시 해 본다
  const [failedApp, setFailedApp] = useState<MapApp | null>(null);
  const [expanded, setExpanded] = useState(false);
  const onFail = useCallback(() => setFailedApp(app), [app]);
  // (#199, D-242) 고른 장소는 저장된 식별자 + 검색어로 지금 다시 찾는다. 직접 적은 장소는 부르지 않는다
  const r = usePlaceResolve(place);
  if (!place) return null;
  const mapFailed = failedApp === app;
  const picked = placeRef(place) !== null;
  const resolved = r.data?.place ?? null;
  const resolving = picked && r.data === null && r.error === null;
  const label = placeLabel(place) ?? "";
  const name = resolved?.name ?? label;
  const address = resolved?.address && resolved.address !== resolved.name ? resolved.address : null;
  const showMap = resolved !== null && canShowMap(app) && !mapFailed;
  return (
    <section aria-labelledby={titleId} className="mt-2.5 rounded-sm bg-surface px-3.5 py-3">
      <h3 id={titleId} className="text-[12px] font-semibold leading-4 text-ink-2">
        장소
      </h3>
      <div className="mt-1.5 flex items-start gap-2">
        <IconPin size={18} active={resolved !== null} className="mt-0.5 shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-semibold leading-6 text-ink">{name}</p>
          {resolving ? (
            <Skeleton className="mt-1 h-3.5 w-40" />
          ) : (
            address && <p className="break-words text-[13px] leading-[18px] text-soft">{address}</p>
          )}
        </div>
      </div>
      {showMap && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-haspopup="dialog"
          className="group relative mt-2.5 block h-36 w-full overflow-hidden rounded-sm border border-line"
        >
          <PlaceMap lat={resolved.lat} lng={resolved.lng} label={`${resolved.name} 위치 지도`} className="size-full" onFail={onFail} />
          {/* 미리보기 지도는 끌리지 않는다. 누르면 크게 */}
          <span className="absolute bottom-2 right-2 flex h-8 items-center gap-1 rounded-full bg-paper/95 px-2.5 text-[12px] font-semibold text-ink shadow-[0_1px_3px_rgba(0,0,0,0.15)]">
            <IconExpand size={14} />
            크게 보기
          </span>
        </button>
      )}
      {/* 다시 찾았으면 길찾기, 못 찾았으면 장소 보기(카카오맵은 ID 로 장소 상세, 네이버 지도는 글자 검색). 지도는 내 정보의 지도 선택 */}
      <DirectionsLink place={place} resolved={resolved} view={Boolean(picked && !resolved)} className="mt-2.5" />
      {expanded && showMap && <MapSheet place={resolved} onClose={() => setExpanded(false)} />}
    </section>
  );
}

/** "네이버 지도로 길찾기"(기본) / "카카오맵으로 길찾기" 보조 버튼 (면 --paper + 1px --line, 13.5/700. --hover 는 라이트에서 칸 바탕과 같아 버튼이 안 보인다). 앱 셸은 target 없이(셸이 OS 로), 브라우저는 새 탭 */
function DirectionsLink({
  place,
  resolved,
  view = false,
  className = "",
}: {
  place: Pick<Place, "text" | "query" | "kakaoPlaceId">;
  resolved: Pick<PlaceCandidate, "name" | "lat" | "lng"> | null;
  view?: boolean;
  className?: string;
}) {
  const inApp = useInApp();
  const [app] = useMapApp();
  const label = directionsLabel(app, view ? "view" : "route");
  return (
    <a
      href={directionsUrl(place, resolved, app)}
      {...(inApp ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      className={`flex h-10 w-full items-center justify-center rounded-md border border-line bg-paper text-[13.5px] font-bold text-ink hover:brightness-95 ${className}`}
    >
      {label}
    </a>
  );
}

/** 지도 크게 보기. 폰은 화면 전체, 넓은 화면은 가운데 창(720 × 560). 끌기, 확대 가능 */
function MapSheet({ place, onClose }: { place: PlaceCandidate; onClose: () => void }) {
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
        <div className="flex h-[calc(52px+var(--sat))] shrink-0 items-center gap-2 px-4 pt-[var(--sat)] fold:h-14 fold:pt-0">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-[18px] font-bold leading-6 tracking-[-0.02em]">
            {place.name}
          </h2>
          <CloseButton onClick={onClose} className="shrink-0" />
        </div>
        <PlaceMap lat={place.lat} lng={place.lng} interactive level={3} label={`${place.name} 위치 지도, 끌어서 옮기고 확대할 수 있어요`} className="min-h-0 flex-1" />
        <div className="shrink-0 border-t border-line px-4 pb-[calc(12px+var(--sab))] pt-3 fold:pb-4">
          {address && <p className="mb-2 break-words text-[13px] leading-[18px] text-soft">{address}</p>}
          <DirectionsLink place={{ text: null, query: null, kakaoPlaceId: place.kakaoPlaceId }} resolved={place} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
