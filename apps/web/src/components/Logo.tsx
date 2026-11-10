import Image from "next/image";

/** brand/ 의 SVG 를 public/ 에 복사해 쓴다. 색 변경, 기울임, 그림자 금지 */
export function Logo({
  variant = "symbol",
  size = 32,
  dark = false,
  className,
}: {
  variant?: "symbol" | "horizontal" | "stacked";
  size?: number; // 높이(px)
  dark?: boolean;
  className?: string;
}) {
  if (variant === "horizontal") {
    const w = Math.round((size * 319) / 88);
    return (
      <Image
        src={dark ? "/logo-horizontal-dark.svg" : "/logo-horizontal.svg"}
        alt="언제볼까"
        width={w}
        height={size}
        priority
        className={className}
      />
    );
  }
  if (variant === "stacked") {
    return (
      <Image src="/logo-stacked.svg" alt="언제볼까" width={size} height={size} priority className={className} />
    );
  }
  return (
    <Image src="/logo-symbol.svg" alt="" width={size} height={size} priority className={className} />
  );
}

/** 2026 심볼: 두 장의 날(레드, 블루)이 겹친 자리에 보라. 목업 .sym 의 치수를 size(기본 40) 비율로 옮긴다.
 *  브랜드 고정색이라 멤버 색 변수와 끊는다 (D-57) */
export function Symbol({ size = 40, className = "" }: { size?: number; className?: string }) {
  const k = size / 40;
  const sq = 23 * k;
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 align-middle ${className}`}
      style={{ width: size, height: size }}
    >
      <i className="absolute block" style={{ left: 3 * k, top: 3 * k, width: sq, height: sq, borderRadius: 8 * k, background: "#FF3D1F" }} />
      <i className="absolute block" style={{ left: 14 * k, top: 14 * k, width: sq, height: sq, borderRadius: 8 * k, background: "#1F5BFF" }} />
      <i
        className="absolute block"
        style={{ left: 14 * k, top: 14 * k, width: 12 * k, height: 12 * k, borderRadius: `0 0 ${8 * k}px 0`, background: "#9A1DFF" }}
      />
    </span>
  );
}
