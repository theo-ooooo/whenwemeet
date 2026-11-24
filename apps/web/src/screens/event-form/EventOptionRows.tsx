"use client";
// (#497) 일정 폼 3. 참여자, 알림, 반복, 색: 줄 넷을 카드 한 장에 (값 ›, 누르면 시트). EventFormScreen 에서 옮김
import { ParticipantValue } from "@/components/Participants";
import { IconBell, IconPalette, IconRepeat, IconTeam } from "@/components/icons";
import { DatePicker } from "@/components/pickers";
import { InlineError, RowButton, RowGroup, Segmented } from "@/components/ui";
import { eventColorName, memberColor } from "@/lib/colors";
import type { DraftAction, EventDraft } from "@/lib/event-draft";
import type { Participants } from "@/lib/participants";
import { repeatLabel } from "@/lib/recurrence-label";
import { REMINDER_LABEL } from "@/lib/reminder";
import type { Repeat } from "@/lib/types";
import type { Dialog } from "./useEventFormUi";

type Props = {
  draft: EventDraft;
  dispatch: React.Dispatch<DraftAction>;
  setDialog: (dialog: Dialog) => void;
  meId: number | null;
  showParticipants: boolean;
  participantsShown: Participants | null;
  participantError: string | null;
  remindError: string | null;
  showRepeat: boolean;
  ruleDateFor: (r: Repeat) => string;
  untilLabelId: string;
  repeatError: string | null;
  autoColors: string[];
  thisOnlyPreset: boolean;
};

export function EventOptionRows({
  draft,
  dispatch,
  setDialog,
  meId,
  showParticipants,
  participantsShown,
  participantError,
  remindError,
  showRepeat,
  ruleDateFor,
  untilLabelId,
  repeatError,
  autoColors,
  thisOnlyPreset,
}: Props) {
  const { startDate, repeat, untilOn, untilDate, reminder, color } = draft;
  const colorDots = color ? [memberColor(color)] : autoColors.length ? autoColors.slice(0, 2) : ["var(--mute)"];
  return (
    <RowGroup>
      {/* 참여자 (#248, 7-3). "이 일정만" 반복 수정과 개인 팀은 숨긴다 */}
      {showParticipants && participantsShown && (
        <div>
          <RowButton
            label="참여자"
            icon={<IconTeam size={18} />}
            onClick={() => setDialog({ kind: "participants" })}
            aria-haspopup="dialog"
            aria-describedby={participantError ? "ev-participants-err" : undefined}
          >
            <ParticipantValue value={participantsShown} meId={meId} />
          </RowButton>
          {participantError && (
            <p id="ev-participants-err" role="alert" className="pb-2 text-[13px] text-danger">
              {participantError}
            </p>
          )}
        </div>
      )}

      {/* 알림 (#188, 8장). 종일 여부로 선택지가 갈린다. 못 받는 기기 안내는 알림 시트 안에 */}
      <div>
        <RowButton label="알림" icon={<IconBell size={18} />} value={REMINDER_LABEL[reminder]} onClick={() => setDialog({ kind: "reminder" })} aria-haspopup="dialog" />
        {remindError && <InlineError className="pb-2">{remindError}</InlineError>}
      </div>

      {showRepeat && (
        <div>
          <RowButton
            label="반복"
            icon={<IconRepeat size={18} />}
            value={repeat ? repeatLabel(repeat, ruleDateFor(repeat)) : "반복 안 함"}
            onClick={() => setDialog({ kind: "repeat" })}
            aria-haspopup="dialog"
          />
          {repeat && (
            <div role="group" aria-label="반복 종료" className="space-y-2 pb-2 pl-8">
              <div className="flex min-h-9 items-center gap-3">
                <span id={`${untilLabelId}`} className="shrink-0 text-[14px] text-ink-2">
                  종료
                </span>
                <div className="ml-auto w-[176px]">
                  <Segmented
                    labelledBy={untilLabelId}
                    value={untilOn ? "date" : "forever"}
                    options={UNTIL_OPTIONS}
                    onChange={(v) => dispatch({ type: "untilOn", value: v === "date" })}
                  />
                </div>
              </div>
              {untilOn && (
                <div className="flex justify-end">
                  <DatePicker look="chip" label="반복 종료 날짜" value={untilDate} min={startDate} onChange={(v) => dispatch({ type: "untilDate", value: v })} />
                </div>
              )}
            </div>
          )}
          {repeatError && <InlineError className="pb-2">{repeatError}</InlineError>}
        </div>
      )}

      {/* (#343) 일정 색: 줄 "색 ● 자동 ›" → 시트에서 자동(참여자 색) + 8색. 반복 "이 일정만" 은 막고 한 줄 안내 */}
      <div>
        <RowButton
          label="색"
          icon={<IconPalette size={18} />}
          onClick={() => setDialog({ kind: "color" })}
          aria-haspopup="dialog"
          aria-label={`색, ${eventColorName(color)}`}
          aria-describedby={thisOnlyPreset ? "ev-color-note" : undefined}
          disabled={thisOnlyPreset}
        >
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[14px] text-ink-2">
            <span aria-hidden="true" className="inline-flex items-center">
              {colorDots.map((c, i) => (
                <i key={i} className="block size-3 rounded-full" style={{ background: c, marginLeft: i ? -4 : 0, boxShadow: i ? "0 0 0 1.5px var(--tile)" : undefined }} />
              ))}
            </span>
            <span className="truncate">{eventColorName(color)}</span>
          </span>
        </RowButton>
        {thisOnlyPreset && (
          <p id="ev-color-note" className="t-sub pb-2 pl-8">
            반복 일정의 색은 이후 모두에서 바꿀 수 있어요
          </p>
        )}
      </div>
    </RowGroup>
  );
}

const UNTIL_OPTIONS: { value: "forever" | "date"; label: string }[] = [
  { value: "forever", label: "계속" },
  { value: "date", label: "날짜까지" },
];
