"use client";
// (#497) 일정 폼 1. 제목 + 장소 (#199 장소를 제목 바로 아래로). EventFormScreen 에서 옮김
import type { RefObject } from "react";
import { NameField } from "@/components/NameField";
import { PlaceField } from "@/components/PlaceField";
import { RowGroup } from "@/components/ui";
import { TITLE_MAX, type DraftAction, type EventDraft } from "@/lib/event-draft";

type Props = {
  title: string;
  place: EventDraft["place"];
  dispatch: React.Dispatch<DraftAction>;
  touch: () => void;
  /** 제목을 한 번이라도 고쳤는지 (#80) */
  titleEditedRef: RefObject<boolean>;
  editing: boolean;
  titleError: string | null;
};

export function TitlePlaceGroup({ title, place, dispatch, touch, titleEditedRef, editing, titleError }: Props) {
  return (
    <RowGroup>
      <NameField
        id="ev-title"
        label="제목"
        placeholder="무슨 일정인가요?"
        value={title}
        max={TITLE_MAX}
        onChange={(v) => {
          dispatch({ type: "title", value: v });
          titleEditedRef.current = true;
        }}
        // 자동 포커스된 빈 제목에서 그냥 벗어나는 것(모바일 키보드 닫기, 날짜 칸 탭)은 오류로 보지 않는다 (#80).
        // 예전에는 blur 마다 touched 를 켜서 제목 아래 오류 줄(약 26px)이 끼어들며 아래 칸이 한 번에 밀렸다
        onBlur={() => {
          if (titleEditedRef.current) touch();
        }}
        autoFocus={!editing}
        autoComplete="off"
        enterKeyHint="next"
        error={titleError}
        errorId="ev-title-err"
      />
      <PlaceField
        place={place}
        onType={(value) => dispatch({ type: "placeText", value })}
        onPick={(value, query) => dispatch({ type: "placePick", value, query })}
        onClear={() => dispatch({ type: "placeClear" })}
      />
    </RowGroup>
  );
}
