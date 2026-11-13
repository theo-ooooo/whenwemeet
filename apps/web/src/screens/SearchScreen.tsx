"use client";
// (#199) 일정 검색 `/search?q=&scope=all` (설계 api.md 2.3 일정 검색, D-245, D-246).
// 기본은 지금 보는 팀, 위 "이 팀 / 모든 팀" 로 넓힌다. 적는 대로 300ms 뒤 찾고(엔터는 바로), 검색어는 주소에만 둔다(저장 안 함).
// 결과는 "다가오는 일정"(시작 순) 다음 "지난 일정"(최근 순). 줄: 날짜, 시각, 반복 표시, 제목(일치 부분 강조), 장소나 메모 한 줄,
// 모든 팀이면 팀 이름. 누르면 기존 일정 상세(`/events/<코드>`, 다른 팀 일정이면 그 팀으로)
// (#378) 머리줄은 하위 화면 공통 ScreenHeader("‹ 일정 검색"), 결과 줄은 일정 줄 EventRow (디자인규칙.md 8장)
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { EventList, EventRow } from "@/components/EventRow";
import { IconSearch } from "@/components/icons";
import { useWho } from "@/components/Participants";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, Segmented, Skeleton, inputClass } from "@/components/ui";
import { messageOf, useEventSearch } from "@/hooks";
import { clampChars } from "@/lib/chars";
import { todayKey } from "@/lib/date";
import { highlight, repeatTag, SEARCH_MAX, searchDateText, searchHref, searchPreview } from "@/lib/event-search";
import { eventKey } from "@/lib/recurrence";
import { CALENDAR_PATH } from "@/lib/routes";
import type { EventSearchItem } from "@/lib/types";

type Scope = "team" | "all";
const SCOPES: { value: Scope; label: string }[] = [
  { value: "team", label: "이 팀" },
  { value: "all", label: "모든 팀" },
];

export function SearchScreen() {
  const params = useSearchParams();
  const { groupId, groups } = useGroupContext();
  const [text, setText] = useState(() => clampChars(params.get("q") ?? "", SEARCH_MAX));
  const scope: Scope = params.get("scope") === "all" ? "all" : "team";
  const [today] = useState(todayKey);
  const scopeLabelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const multiTeam = (groups?.length ?? 0) > 1;
  const q = useEventSearch(text, scope === "all" ? null : groupId);
  const query = text.trim();

  // 검색어, 범위를 주소에 둔다 (뒤로 가기, 새로 고침에서 결과 유지). 기록은 쌓지 않는다.
  // 글자마다 서버 왕복(router.replace)을 하지 않도록 history.replaceState 로 (Next 가 useSearchParams 와 맞춘다)
  useEffect(() => {
    const next = searchHref(text.trim(), scope === "all");
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
  }, [text, scope]);

  const items = q.data?.items ?? [];
  const upcoming = items.filter((it) => it.upcoming);
  const past = items.filter((it) => !it.upcoming);
  const showTeam = scope === "all" && multiTeam;

  return (
    <div>
      <ScreenHeader title="일정 검색" fallbackHref={CALENDAR_PATH} />

      <form
        role="search"
        className="mt-3 space-y-2.5 main-lg:max-w-[720px]"
        onSubmit={(e) => {
          e.preventDefault();
          inputRef.current?.blur();
          void q.refetch();
        }}
      >
        <div className="relative">
          <IconSearch size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-2" />
          <input
            ref={inputRef}
            type="search"
            aria-label="일정 검색어"
            enterKeyHint="search"
            autoComplete="off"
            autoFocus={!text}
            className={`${inputClass} bg-paper! pl-10 text-[15px]!`}
            placeholder="제목, 메모, 장소로 찾기"
            value={text}
            onChange={(e) => setText(clampChars(e.target.value, SEARCH_MAX))}
          />
        </div>
        {multiTeam && (
          <div className="flex items-center gap-3">
            <span id={scopeLabelId} className="sr-only">
              찾을 팀
            </span>
            <div className="w-[200px]">
              <Segmented labelledBy={scopeLabelId} value={scope} options={SCOPES} onChange={(v) => window.history.replaceState(null, "", searchHref(text.trim(), v === "all"))} />
            </div>
          </div>
        )}
      </form>

      <div className="mt-4 main-lg:max-w-[720px]" aria-live="polite">
        {!query ? (
          <p className="px-1 text-[13px] leading-5 text-ink-2">일정 제목, 메모, 장소에 든 말로 찾아요. 검색어는 저장하지 않아요</p>
        ) : q.error && !q.data ? (
          <ErrorState message={messageOf(q.error, "일정을 찾지 못했어요. 잠시 후 다시 시도해 주세요")} onRetry={() => void q.refetch()} />
        ) : q.data === null ? (
          <ResultSkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon={<IconSearch size={20} />} title={`‘${query}’ 일정이 없어요`}>
            {scope === "team" && multiTeam ? "모든 팀에서 찾아 보세요" : "다른 말로 찾아 보세요"}
          </EmptyState>
        ) : (
          <>
            {upcoming.length > 0 && <ResultGroup title="다가오는 일정" items={upcoming} q={query} today={today} showTeam={showTeam} />}
            {past.length > 0 && <ResultGroup title="지난 일정" items={past} q={query} today={today} showTeam={showTeam} spaced={upcoming.length > 0} />}
            {q.data.hasMore && <p className="mt-3 px-1 text-[12px] leading-4 text-ink-2">결과가 많아 일부만 보여요. 검색어를 더 구체적으로 적어 주세요</p>}
          </>
        )}
      </div>
    </div>
  );
}

function ResultGroup({ title, items, q, today, showTeam, spaced = false }: { title: string; items: EventSearchItem[]; q: string; today: string; showTeam: boolean; spaced?: boolean }) {
  const who = useWho();
  const [now] = useState(Date.now);
  return (
    <section aria-label={title} className={spaced ? "mt-6" : ""}>
      <h2 className="mb-2 text-[13px] font-bold leading-[18px] text-ink-2">{title}</h2>
      <EventList>
        {items.map((it) => (
          <ResultRow key={`${it.group.id}-${eventKey(it.event)}`} item={it} q={q} today={today} showTeam={showTeam} who={who} now={now} />
        ))}
      </EventList>
    </section>
  );
}

function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlight(text, q).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-[color-mix(in_srgb,var(--acc-ink)_18%,transparent)] px-px text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function ResultRow({
  item,
  q,
  today,
  showTeam,
  who,
  now,
}: {
  item: EventSearchItem;
  q: string;
  today: string;
  showTeam: boolean;
  who: ReturnType<typeof useWho>;
  now: number;
}) {
  const ev = item.event;
  const tag = repeatTag(ev.repeat);
  // 장소는 일정 줄이 핀과 함께 그린다. 메모가 맞았을 때만 메모 한 줄을 더 (장소 줄과 겹치지 않게)
  const preview = searchPreview(item, q);
  const memo = preview?.kind === "memo" ? preview.text : null;
  return (
    <EventRow
      event={ev}
      who={who}
      dateText={searchDateText(ev.startsAt, today)}
      now={now}
      title={<Marked text={ev.title} q={q} />}
      extra={
        <>
          {tag && <span className="shrink-0 rounded-[4px] bg-hover px-1 text-[11px] font-semibold leading-4">{tag}</span>}
          {showTeam && <span className="ml-auto max-w-[40%] shrink-0 truncate font-semibold text-soft">{item.group.name}</span>}
        </>
      }
      note={memo ? <Marked text={memo} q={q} /> : undefined}
      labelExtra={[tag, showTeam ? item.group.name : null, memo]}
    />
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="찾는 중">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[68px] rounded-xl" />
      ))}
    </div>
  );
}
