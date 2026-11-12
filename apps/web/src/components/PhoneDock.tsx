// 폰(<600) 아래 유리 알약 독의 메뉴 칸 (디자인규칙.md 4-1). 오른쪽 코랄 원 + 는 AppShell 이 그린다.
// (#332, D-212) 5칸: 달력, 빈 시간, 할 일, 기념일, 팀. 선택된 칸만 먹색 칩(높이 44, 모서리 22) + 아이콘 + 이름 14/700, 나머지는 아이콘만.
//   칸마다 누르는 영역 최소 44×44. 칩은 폭과 면이 200ms 로 옮겨 간다 (prefers-reduced-motion 이면 globals.css 가 즉시로)
import Link from "next/link";
import { ANNIVERSARIES_PATH, CALENDAR_PATH, FREE_PATH, TEAM_PATH, TODOS_PATH, type activeTab } from "@/lib/routes";
import { IconCalendar, IconFree, IconHeart, IconTeam, IconTodo } from "./icons";

export const DOCK_TABS = [
  { key: "calendar", label: "달력", href: CALENDAR_PATH },
  { key: "free", label: "빈 시간", href: FREE_PATH },
  { key: "todos", label: "할 일", href: TODOS_PATH },
  { key: "anniversaries", label: "기념일", href: ANNIVERSARIES_PATH },
  { key: "team", label: "팀", href: TEAM_PATH },
] as const;

type DockKey = (typeof DOCK_TABS)[number]["key"];

/** 독 아이콘: 선택 칩 안은 24, 아이콘만 있는 칸은 26 (디자인규칙.md 3-1, 4-1). 선택이면 겹침 조각만 코랄 */
function TabIcon({ name, active }: { name: DockKey; active: boolean }) {
  const size = active ? 24 : 26;
  switch (name) {
    case "calendar":
      return <IconCalendar size={size} active={active} />;
    case "free":
      return <IconFree size={size} active={active} />;
    case "todos":
      return <IconTodo size={size} active={active} />;
    case "anniversaries":
      return <IconHeart size={size} active={active} />;
    case "team":
      return <IconTeam size={size} active={active} />;
  }
}

/** 이 칸을 켤지. 다가오는 일정 목록(#222)과 일정 화면은 달력에 딸린 화면이라 달력 칩을 켠다. 할 일은 목록 화면에서만(상세는 독을 숨긴다) */
export function isDockActive(key: DockKey, tab: ReturnType<typeof activeTab>): boolean {
  return tab === key || (key === "calendar" && tab === "upcoming");
}

export function DockTabs({ tab, className = "" }: { tab: ReturnType<typeof activeTab>; className?: string }) {
  return (
    <nav aria-label="주요 화면" className={`glass-dock h-16 min-w-0 rounded-full px-1.5 ${className}`}>
      <ul className="flex h-full items-center justify-between">
        {DOCK_TABS.map((t) => {
          const active = isDockActive(t.key, tab);
          return (
            <li key={t.key} className="flex h-full shrink-0 items-center">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                aria-label={active ? undefined : t.label}
                className="grid h-full min-w-11 place-items-center"
              >
                <span
                  className={`flex h-11 items-center justify-center rounded-[22px] transition-[background-color,color,padding] duration-200 ease-out ${
                    active ? "bg-ink pl-2.5 pr-3.5 text-on-ink" : "px-0 text-ink-2"
                  }`}
                >
                  <TabIcon name={t.key} active={active} />
                  <span
                    className={`overflow-hidden whitespace-nowrap text-[14px] font-bold leading-5 transition-[max-width,opacity,margin] duration-200 ease-out ${
                      active ? "ml-1.5 max-w-16 opacity-100" : "ml-0 max-w-0 opacity-0"
                    }`}
                    aria-hidden={active ? undefined : true}
                  >
                    {t.label}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
