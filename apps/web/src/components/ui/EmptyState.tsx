"use client";

/* ---------- 상태 블록 ---------- */

/** 빈 상태 (#174 L5): 카드 가운데, 아이콘 20 을 원 40 에 + 제목 14/600 + 보조 12/400. 날짜 시트의 빈 날과 같은 모양 */
export function EmptyState({
  icon,
  title,
  children,
  className = "py-6",
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  /** 세로 여백. 카드 안에 넣을 때는 줄인다 */
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center rounded-xl bg-paper px-4 text-center ${className}`}>
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-hover text-acc-ink">
        {icon}
      </span>
      <p className="mt-2.5 text-[14px] font-semibold leading-5 text-ink">{title}</p>
      {children && <p className="mt-0.5 text-[12px] leading-4 text-ink-2">{children}</p>}
    </div>
  );
}
