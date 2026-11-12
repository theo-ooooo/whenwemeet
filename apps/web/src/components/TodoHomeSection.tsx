"use client";
// (#276) 폰 홈 "할 일" 구역 (디자인규칙.md 2-1, 5, D-206). 기념일 구역 아래.
// 제목줄 "할 일" + "전체보기 ›" → 가로 카드 148×84(목록 이름 15/600 한 줄 / "남은 N개" 13 --mute, 0 이면 "다 했어요").
// 목록이 없어도 구역은 지우지 않고 한 줄 안내 + "목록 만들기". 넓은 화면은 사이드바 "할 일" 메뉴가 입구라 받지 않는다
import Link from "next/link";
import { messageOf, useRefetchOnVisible, useTodoLists } from "@/hooks";
import { remainingLabel } from "@/lib/todo";
import { todoListHref, todosHref } from "@/lib/routes";
import { IconChevronRight } from "./icons";
import { Skeleton } from "./ui";

export function TodoHomeSection({ groupId, enabled, titleId }: { groupId: number; enabled: boolean; titleId: string }) {
  const q = useTodoLists(groupId, { enabled });
  useRefetchOnVisible(q.refetch, enabled);
  const lists = q.data?.items ?? null;
  // 가로 카드 줄: 달력 홈의 다가오는 일정, 기념일 구역과 같은 값 (폭 148, 간격 10, 좌우 20 선에서 시작해 화면 밖으로 잘려 보인다)
  const rail = "-mx-5 flex snap-x gap-2.5 overflow-x-auto scroll-px-5 px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
  const line = "flex h-11 items-center gap-1.5 text-[14px] text-ink-2";

  return (
    <section aria-labelledby={titleId} className="mt-[22px]">
      <div className="mb-2 flex h-8 items-center">
        <h2 id={titleId} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
          할 일
        </h2>
        <span className="flex-1" />
        <Link href={todosHref()} className="hit flex h-8 items-center gap-0.5 text-[13px] text-ink-2 hover:text-ink">
          전체보기
          <IconChevronRight size={14} />
        </Link>
      </div>
      {q.error ? (
        <p className={line}>
          {messageOf(q.error, "할 일을 불러오지 못했어요")}.
          <button type="button" onClick={() => void q.refetch()} className="font-bold text-btn">
            다시 시도
          </button>
        </p>
      ) : lists === null ? (
        <div className={rail} aria-busy="true" aria-label="불러오는 중">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[84px] w-[148px] shrink-0 rounded-xl" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <p className={line}>
          같이 챙길 것을 적어 두세요.
          <Link href={todosHref({ create: true })} className="font-bold text-btn">
            목록 만들기
          </Link>
        </p>
      ) : (
        <ul className={rail}>
          {lists.map((l) => {
            const sub = remainingLabel(l);
            return (
              <li key={l.id} className="shrink-0 snap-start">
                <Link
                  href={todoListHref(l)}
                  aria-label={`${l.name}, ${sub}`}
                  className="flex h-[84px] w-[148px] flex-col justify-between rounded-xl bg-paper px-3.5 py-3 text-left hover:bg-hover"
                >
                  <b aria-hidden="true" className="truncate text-[15px] font-semibold leading-5">
                    {l.name}
                  </b>
                  <span aria-hidden="true" className="truncate text-[13px] leading-[18px] text-ink-2">
                    {sub}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
