"use client";
// (#199) 일정 폼의 "장소" 칸. 적는 대로 장소 검색(우리 API → 카카오 로컬) 후보를 아래에 띄우고, 고르면 이름, 주소, 좌표, 카카오 장소 ID 가
// 초안에 붙는다(상세에서 지도). 고르지 않고 적은 글자 그대로도 저장된다(지도 없음). 내 위치는 쓰지 않는다 (D-244).
// 검색이 안 되면(키 없음 503, 카카오 오류) 후보 없이 직접 입력만 남는다. 검색어는 저장하지 않는다
import { useId, useRef, useState } from "react";
import { usePlaceSearch } from "@/hooks";
import { placeHint, type DraftPlace } from "@/lib/place";
import type { PlaceCandidate } from "@/lib/types";
import { IconClose, IconPin } from "./icons";
import { captionClass, inputClass, Spinner } from "./ui";

/** 후보는 6개까지 (폰 화면 한 번에) */
const MAX_OPTIONS = 6;

export function PlaceField({
  place,
  onType,
  onPick,
  onClear,
}: {
  place: DraftPlace;
  onType: (value: string) => void;
  onPick: (c: PlaceCandidate) => void;
  onClear: () => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = place.name.trim();
  // 고른 뒤에는 다시 찾지 않는다 (이름을 고치면 picked 가 풀리고 다시 찾는다)
  const q = usePlaceSearch(typed, open && place.picked === null);
  const options = (q.data?.items ?? []).slice(0, MAX_OPTIONS);
  const showList = open && place.picked === null && typed.length > 0 && (options.length > 0 || q.isLoading || q.error !== null);
  const unavailable = q.error !== null;

  const pick = (c: PlaceCandidate) => {
    onPick(c);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList || options.length === 0) {
      if (e.key === "Escape" && open) {
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className={captionClass}>
          장소
        </label>
        <span className="text-[12px] leading-4 text-ink-2">{placeHint(place)}</span>
      </div>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          enterKeyHint="done"
          className={`${inputClass} ${place.name ? "pr-11" : ""}`}
          placeholder="장소 이름이나 주소로 찾기"
          value={place.name}
          onChange={(e) => {
            onType(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          // 후보를 누르는 동안 닫히지 않게 한 박자 늦게 닫는다
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        {place.name && (
          <button
            type="button"
            aria-label="장소 지우기"
            onClick={() => {
              onClear();
              inputRef.current?.focus();
            }}
            className="hit absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
          >
            <IconClose size={16} />
          </button>
        )}
      </div>

      {showList && (
        <div className="mt-1.5 overflow-hidden rounded-sm border border-line bg-paper">
          <ul id={listId} role="listbox" aria-label="장소 후보">
            {options.map((c, i) => (
              <li
                key={c.kakaoPlaceId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // 입력칸 blur 보다 먼저 고르게
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className={`flex min-h-12 cursor-pointer items-start gap-2.5 px-3 py-2 ${i === active ? "bg-hover" : "hover:bg-hover"} ${i > 0 ? "border-t border-line" : ""}`}
              >
                <IconPin size={18} className="mt-0.5 shrink-0 text-ink-2" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <b className="truncate text-[14px] font-semibold leading-5">{c.name}</b>
                    {c.category && <span className="shrink-0 text-[12px] text-ink-2">{c.category}</span>}
                  </span>
                  {c.address && <span className="block truncate text-[12px] leading-4 text-ink-2">{c.address}</span>}
                </span>
              </li>
            ))}
          </ul>
          {q.isLoading && options.length === 0 && (
            <p className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-ink-2" aria-live="polite">
              <Spinner className="size-3.5" /> 장소를 찾는 중
            </p>
          )}
          {unavailable && (
            <p className="px-3 py-2.5 text-[12px] leading-4 text-ink-2" aria-live="polite">
              지금은 장소를 찾을 수 없어요. 적은 이름 그대로 저장돼요
            </p>
          )}
        </div>
      )}

      <p id={hintId} className="t-sub mt-1.5 flex items-center gap-1">
        {place.picked ? (
          <>
            <IconPin size={14} active className="shrink-0" />
            <span className="min-w-0 truncate">{place.picked.address ? `${place.picked.address}, 지도에 표시돼요` : "지도에 표시돼요"}</span>
          </>
        ) : typed ? (
          "목록에서 고르면 지도에 표시돼요. 고르지 않으면 적은 이름 그대로 저장돼요"
        ) : (
          "카페, 식당 이름이나 주소로 찾아 보세요"
        )}
      </p>
    </div>
  );
}
