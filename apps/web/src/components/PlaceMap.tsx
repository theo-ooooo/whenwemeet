"use client";
// (#199) 카카오 지도 한 장 + 핀. SDK 는 이 칸이 처음 그려질 때 받는다 (lib/kakao-map.ts).
// 미리보기(interactive=false)는 끌기, 확대를 끈 그림, 크게 보기(interactive)는 끌기, 확대 + 확대 단추.
// 키가 없거나 SDK 를 못 받으면 onFail 을 부르고 아무것도 그리지 않는다 (장소 글자와 길찾기 버튼이 남는다, D-244)
import { useEffect, useRef, useState } from "react";
import { kakaoJsKey } from "@/lib/kakao-share";
import { loadKakaoMaps } from "@/lib/kakao-map";
import { Skeleton } from "./ui";

type Status = "loading" | "ready" | "failed";

/** 지도를 그릴 수 있는 환경인지 (키가 빌드에 들어 있는지). 없으면 칸 자체를 만들지 않는다 */
export function canShowMap(): boolean {
  return kakaoJsKey() !== null;
}

export function PlaceMap({
  lat,
  lng,
  interactive = false,
  level = 3,
  className = "",
  label,
  onFail,
}: {
  lat: number;
  lng: number;
  interactive?: boolean;
  level?: number;
  className?: string;
  /** 지도 그림의 이름 (스크린 리더) */
  label: string;
  onFail?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);

  useEffect(() => {
    let alive = true;
    let observer: ResizeObserver | null = null;
    void loadKakaoMaps().then((maps) => {
      if (!alive) return;
      if (!maps || !box.current) {
        setStatus("failed");
        failRef.current?.();
        return;
      }
      try {
        const center = new maps.LatLng(lat, lng);
        const map = new maps.Map(box.current, { center, level, draggable: interactive, scrollwheel: interactive, disableDoubleClickZoom: !interactive });
        map.setZoomable(interactive);
        new maps.Marker({ position: center, map });
        if (interactive) map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);
        // 시트가 열리며 크기가 바뀌면 다시 맞춘다
        observer = new ResizeObserver(() => {
          map.relayout();
          map.setCenter(center);
        });
        observer.observe(box.current);
        setStatus("ready");
      } catch {
        setStatus("failed");
        failRef.current?.();
      }
    });
    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [lat, lng, interactive, level]);

  if (status === "failed") return null;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div ref={box} role="img" aria-label={label} className="absolute inset-0" />
      {status === "loading" && <Skeleton className="absolute inset-0 rounded-none" />}
    </div>
  );
}
