// (#515) 공지 종류 작은 표 (칩 모서리 5, 11/700). 색만으로 나누지 않고 글자로 읽힌다
import { NOTICE_KIND_LABEL } from "@/lib/notice";
import type { NoticeKind } from "@/lib/types";

const KIND_CLASS: Record<NoticeKind, string> = {
  notice: "text-ink-2",
  update: "text-acc-ink",
  maintenance: "text-danger",
};

export function NoticeKindBadge({ kind }: { kind: NoticeKind }) {
  return (
    <span className={`inline-flex h-5 shrink-0 items-center rounded-[5px] bg-hover px-1.5 text-[11px] font-bold leading-none ${KIND_CLASS[kind]}`}>
      {NOTICE_KIND_LABEL[kind]}
    </span>
  );
}

/** 상단 고정 표 */
export function PinnedBadge() {
  return <span className="inline-flex h-5 shrink-0 items-center rounded-[5px] bg-ink px-1.5 text-[11px] font-bold leading-none text-on-ink">고정</span>;
}
