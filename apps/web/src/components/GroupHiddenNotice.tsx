"use client";
// (#515) 운영 숨김 팀 안내 (D-286). 팀 화면 뼈대(머리줄, 팀 바꾸기)는 그대로 두고 본문만 바꾼다. 다른 팀으로 바로 옮길 수 있게
import Link from "next/link";
import { Button } from "./ui";

export const GROUP_HIDDEN_TITLE = "운영 정책 위반으로 이용이 제한된 팀이에요";

export function GroupHiddenNotice({ reason, onSwitchTeam }: { reason: string; onSwitchTeam: () => void }) {
  return (
    <section role="alert" aria-labelledby="group-hidden-title" className="mx-auto mt-6 w-full max-w-[480px] rounded-xl bg-paper px-5 py-6">
      <span className="inline-flex text-[13px] font-bold text-danger">이용 제한</span>
      <h1 id="group-hidden-title" className="mt-2 break-keep text-[22px] font-bold leading-[1.3] tracking-[-0.02em]">
        {GROUP_HIDDEN_TITLE}
      </h1>
      {reason && (
        <div className="mt-4 rounded-md bg-surface px-3.5 py-3">
          <p className="text-[12px] font-semibold text-ink-2">사유</p>
          <p className="mt-0.5 whitespace-pre-line break-words text-[14px] leading-5 text-ink">{reason}</p>
        </div>
      )}
      <p className="mt-4 text-[14px] leading-[22px] text-soft">
        이 팀의 달력과 일정은 지금 볼 수 없어요. 잘못된 조치라고 생각되면{" "}
        <Link href="/support" className="font-semibold text-ink underline underline-offset-2">
          고객 지원
        </Link>
        으로 알려 주세요.
      </p>
      <div className="mt-6">
        <Button size="lg" full onClick={onSwitchTeam}>
          다른 팀 열기
        </Button>
      </div>
    </section>
  );
}
