"use client";
// (#278) 팀 만들기 쓰임별 시작 안내. 달력 위 정보 카드에서 같이 쓰기 입구(TogetherHint)보다 위.
// 머리 한 줄(아이콘 16 + 13 + 닫기, TogetherHint 와 같은 모양) + 아직 안 한 단계 줄(RowLink). 안내 상태는 이 기기에만 (lib/start-guide.ts)
// 단계를 누르면 그 단계는 끝낸 것으로 친다. 단, 첫 단계 화면에서 저장해야 하는 단계(처음 만난 날, 정기 모임)는 저장해야 끝난다
import { finishStep, clearStart, useStartGuide } from "@/lib/start-guide";
import { remainingSteps, type StartStepIcon } from "@/lib/team-preset";
import { IconCalendar, IconClose, IconFree, IconHeart, IconPin, IconTodo } from "./icons";
import { RowLink } from "./ui";

const ICONS: Record<StartStepIcon, React.ReactNode> = {
  heart: <IconHeart size={18} />,
  calendar: <IconCalendar size={18} />,
  free: <IconFree size={18} />,
  todo: <IconTodo size={18} />,
  pin: <IconPin size={18} />,
};

export function StartGuide({ groupId }: { groupId: number }) {
  const state = useStartGuide(groupId);
  if (!state) return null;
  const steps = remainingSteps(state.preset, state.done);
  if (steps.length === 0) return null;
  return (
    <>
      <section aria-labelledby={`start-guide-${groupId}`}>
        <div className="flex h-10 items-center gap-2 text-[13px]">
          <IconCalendar size={16} className="shrink-0 text-acc-ink" />
          <h2 id={`start-guide-${groupId}`} className="min-w-0 truncate font-bold">
            이렇게 시작해 보세요
          </h2>
          <button
            type="button"
            onClick={() => clearStart(groupId)}
            aria-label="시작 안내 닫기"
            className="hit -mr-1.5 ml-auto grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
          >
            <IconClose size={14} />
          </button>
        </div>
        <ul className="pb-1">
          {steps.map((s) => (
            <li key={s.id}>
              <RowLink href={s.href} label={s.label} icon={ICONS[s.icon]} onClick={s.saves ? undefined : () => finishStep(groupId, s.id)} />
            </li>
          ))}
        </ul>
      </section>
      <div aria-hidden="true" className="h-px bg-line" />
    </>
  );
}
