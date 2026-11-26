"use client";
import { useEffect, useRef, useState } from "react";
import { memberColor, ON_MEMBER_COLOR } from "@/lib/colors";
import type { Member } from "@/lib/types";

/**
 * 프로필 (기본 28). 사진이 있으면 사진, 없으면 이니셜 원 (#168)
 * - color(멤버 색 키)가 있으면 이니셜 바탕을 멤버 색, 글자는 --on-member (#347: 라이트 먹색, 다크 #121214). 사진에는 2px 멤버 색 링
 * - color 가 없으면(팀 밖 내 정보) 중립 원 (--faint 바탕, --ink 글자)
 * - 새 사진을 받는 동안에는 이전 사진(없으면 이니셜)을 그대로 둔다 (#174 L6)
 */
export function Avatar({ member, size = 28, color }: { member: Pick<Member, "displayName" | "profileImageUrl">; size?: number; color?: string | null }) {
  const initial = member.displayName.trim().slice(0, 1) || "?";
  const src = member.profileImageUrl;
  // 마지막으로 다 받은 사진 주소. 새 주소를 받는 동안 이전 사진을 밑에 깔아 둔다
  const [ready, setReady] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // 하이드레이션 전에 이미 받은(캐시) 사진은 onLoad 가 안 올 수 있다
    const img = imgRef.current;
    if (src && img?.complete && img.naturalWidth > 0) setReady(src);
  }, [src]);
  const tint = color ? memberColor(color) : null;
  const ring = tint && src ? 2 : 0;
  const shown = src && ready === src;
  const under = !shown && ready && ready !== src ? ready : null;
  const imgStyle = { inset: ring, width: size - ring * 2, height: size - ring * 2 };
  return (
    <span
      aria-hidden="true"
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full ${tint ? "" : "bg-faint text-ink"}`}
      style={{
        width: size,
        height: size,
        backgroundColor: tint ?? undefined,
        color: tint ? ON_MEMBER_COLOR : undefined,
        fontSize: Math.round(size * 0.43),
        fontWeight: 700,
      }}
    >
      {initial}
      {under && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={under} alt="" className="absolute rounded-full bg-surface object-cover" style={imgStyle} />
      )}
      {src && (
        // 외부(카카오) 이미지라 next/image 도메인 설정 대신 img 를 쓴다
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          key={src}
          src={src}
          alt=""
          onLoad={() => setReady(src)}
          className={`absolute rounded-full bg-surface object-cover transition-opacity duration-150 ${shown ? "opacity-100" : "opacity-0"}`}
          style={imgStyle}
        />
      )}
    </span>
  );
}
