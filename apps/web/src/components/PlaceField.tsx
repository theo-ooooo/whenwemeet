"use client";
// (#199) 일정 폼의 "장소" 칸. 적는 대로 장소 검색(우리 API → 내 정보의 지도 선택에 따라 네이버 지역 검색 또는 카카오 로컬, D-259) 후보를
// 아래에 띄우고, 고르면 식별자(카카오 장소 ID, 네이버 키)와 그때 적은 검색어만 초안에 붙는다(이름, 주소, 좌표는 저장하지 않는다, D-242).
// 고른 장소는 입력칸 대신 카드로 보이고 (이름, 주소는 고른 순간 값 또는 다시 찾은 값), ✕ 로 풀면 다시 적는다. 고르지 않고 적은 글자 그대로도
// 저장된다(지도 없음). 내 위치는 쓰지 않는다 (D-244). 검색이 안 되면(키 없음 503, 검색 오류) 후보 없이 직접 입력만 남는다. 검색어는 저장하지 않는다
import { useId, useRef, useState } from "react";
import { usePlaceResolve, usePlaceSearch } from "@/hooks";
import { charCount, nearLimit } from "@/lib/chars";
import { candidateKey, PLACE_MAX, placeHint, type DraftPlace } from "@/lib/place";
import { useMapApp } from "@/lib/useMapApp";
import type { PlaceCandidate, PlaceProvider } from "@/lib/types";
import { IconClose, IconPin } from "./icons";
import { Spinner } from "./ui";

/** 후보는 6개까지 (폰 화면 한 번에). 네이버는 5개까지 온다 */
const MAX_OPTIONS = 6;

/** 결과 출처 표기 (이용 조건) */
const SOURCE_NOTE: Record<PlaceProvider, string> = { naver: "네이버 검색 결과", kakao: "카카오 검색 결과" };
const SOURCE_NAME: Record<PlaceProvider, string> = { naver: "네이버", kakao: "카카오" };

export function PlaceField({
  place,
  onType,
  onPick,
  onClear,
}: {
  place: DraftPlace;
  onType: (value: string) => void;
  /** query: 고를 때 입력칸에 적혀 있던 사용자 검색어 */
  onPick: (c: PlaceCandidate, query: string) => void;
  onClear: () => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = place.text.trim();
  // 검색 출처는 내 정보의 지도 선택 (D-259)
  const [app] = useMapApp();
  // 고른 뒤에는 다시 찾지 않는다 (이름을 고치면 picked 가 풀리고 다시 찾는다)
  const q = usePlaceSearch(typed, app, open && place.picked === null);
  const options = (q.data?.items ?? []).slice(0, MAX_OPTIONS);
  const showList = open && place.picked === null && typed.length > 0 && (options.length > 0 || q.isLoading || q.error !== null);
  const unavailable = q.error !== null;

  const pick = (c: PlaceCandidate) => {
    onPick(c, place.text);
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
    <div className="py-1">
      {/* (#378) 제목 아래 같은 카드의 한 줄: 핀 + "장소 추가". 이름 글자는 sr-only, 글자 수는 80% 부터 */}
      {place.picked ? (
        <PickedCard
          id={id}
          picked={place.picked}
          onClear={() => {
            onClear();
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        />
      ) : (
        <div className="flex min-h-11 items-center gap-3">
          <IconPin size={18} className="shrink-0 text-ink-2" />
          <label htmlFor={id} className="sr-only">
            장소
          </label>
          <div className="relative min-w-0 flex-1">
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
              className={`-mx-1.5 min-h-11 w-[calc(100%+12px)] rounded-sm bg-transparent px-1.5 text-[14px] leading-5 text-ink placeholder:text-ink-2 focus:outline-2 focus:outline-ink focus:outline-offset-0 ${place.text ? "pr-10" : ""}`}
              placeholder="장소 추가"
              value={place.text}
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
            {place.text && (
              <button
                type="button"
                aria-label="장소 지우기"
                onClick={() => {
                  onClear();
                  inputRef.current?.focus();
                }}
                className="hit absolute -right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
              >
                <IconClose size={16} />
              </button>
            )}
          </div>
          {nearLimit(charCount(place.text), PLACE_MAX) && <span className="shrink-0 text-[12px] tabular-nums text-ink-2">{placeHint(place)}</span>}
        </div>
      )}

      {showList && (
        <div className="mb-1.5 mt-1 overflow-hidden rounded-sm border border-line bg-paper">
          <ul id={listId} role="listbox" aria-label="장소 후보">
            {options.map((c, i) => (
              <li
                key={candidateKey(c)}
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
          {options.length > 0 && (
            <p className="border-t border-line px-3 py-1 text-right text-[11px] leading-4 text-ink-2">{SOURCE_NOTE[options[0].provider]}</p>
          )}
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

      {/* 안내는 적었을 때 한 줄만. 빈 칸은 "장소 추가" 가 대신한다(읽기 이름에는 남긴다) */}
      <p id={hintId} className={typed && !place.picked ? "t-sub pb-1.5 pl-[30px]" : "sr-only"}>
        {place.picked
          ? `${SOURCE_NAME[place.picked.provider]} 장소로 저장돼요. 일정을 열 때마다 ${SOURCE_NAME[place.picked.provider]}에서 이름과 위치를 다시 받아요`
          : typed
            ? "목록에서 고르면 지도에 표시돼요. 고르지 않으면 적은 이름 그대로 저장돼요"
            : "카페, 식당 이름이나 주소로 찾아 보세요"}
      </p>
    </div>
  );
}

/** 고른 장소 카드: 핀 + 이름(고른 순간 값, 불러온 일정이면 다시 찾은 값, 그것도 없으면 검색어) + 주소 + ✕ */
function PickedCard({ id, picked, onClear }: { id: string; picked: NonNullable<DraftPlace["picked"]>; onClear: () => void }) {
  const r = usePlaceResolve(picked.name ? null : picked);
  const name = picked.name ?? r.data?.place?.name ?? picked.query;
  const address = picked.name ? picked.address : (r.data?.place?.address ?? null);
  return (
    <div id={id} tabIndex={-1} className="flex min-h-11 items-center gap-3 rounded-sm py-1.5">
      <IconPin size={18} active className="shrink-0 text-ink-2" />
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px] font-semibold leading-5">{name}</b>
        {address && <span className="block truncate text-[12px] leading-4 text-ink-2">{address}</span>}
      </span>
      <button
        type="button"
        aria-label="고른 장소 풀기"
        onClick={onClear}
        className="hit -mr-1.5 grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
      >
        <IconClose size={16} />
      </button>
    </div>
  );
}
