"use client";
// (#199) 일정 상세의 메모 칸. 예전에는 참여자 아래 작은 글자 한 줄이라 눈에 띄지 않았다 (사장님 지적).
// "메모" 이름이 있는 칸 + 15/24 읽기 좋은 글자 + 줄바꿈 유지 + http(s) 주소는 링크. 메모가 없으면 칸을 그리지 않는다
import { useId } from "react";
import { linkify } from "@/lib/place";
import { useInApp } from "@/lib/useInApp";

export function MemoSection({ memo }: { memo: string | null | undefined }) {
  const titleId = useId();
  const inApp = useInApp();
  const text = memo?.trim();
  if (!text) return null;
  return (
    <section aria-labelledby={titleId} className="mt-2.5 rounded-sm bg-surface px-3.5 py-3">
      <h3 id={titleId} className="text-[12px] font-semibold leading-4 text-ink-2">
        메모
      </h3>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-6 text-ink">
        {linkify(text).map((part, i) =>
          part.href ? (
            // 앱 셸은 외부 주소를 OS 로 넘긴다(target 없이). 브라우저는 새 탭
            <a
              key={i}
              href={part.href}
              {...(inApp ? {} : { target: "_blank", rel: "noopener noreferrer" })}
              className="break-all font-medium text-btn underline underline-offset-2"
            >
              {part.text}
            </a>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
    </section>
  );
}
