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
