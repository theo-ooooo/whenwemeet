// (#339) 팀 화면 loading.tsx 의 뼈대. 메뉴를 누르면 서버 응답(RSC)을 기다리지 않고 이 뼈대로 바로 바뀐다.
// loading 경계가 있어야 Link 가 이 뼈대까지 미리 받아 두고(프리페치) 누르는 즉시 주소와 화면을 옮긴다.
// 제목은 화면이 그릴 것과 같은 글자(t-title)로 먼저 보여 주고, 내용 자리만 스켈레톤으로 둔다
import { Skeleton } from "./ui";

type Props = {
  /** 화면 제목. 달력은 제목줄이 달라 없다 */
  title?: string;
  /** calendar: 제목줄 + 큰 판, list: 카드 줄 */
  kind?: "calendar" | "list";
};

export function ScreenLoading({ title, kind = "list" }: Props) {
  return (
    <div className="pt-1" aria-busy="true" aria-label="불러오는 중">
      {kind === "calendar" ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-[320px] w-full rounded-xl" />
        </div>
      ) : (
        <>
          <div className="flex h-10 items-center">
            {title ? <p className="t-title">{title}</p> : <Skeleton className="h-6 w-28" />}
          </div>
          <div className="mt-3 space-y-2.5">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        </>
      )}
    </div>
  );
}
