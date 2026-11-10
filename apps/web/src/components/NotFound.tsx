// '페이지를 찾을 수 없어요' (#64). 잘못된 주소, 숫자가 아닌 ID(idParam 의 notFound) 에서 Next 기본 영어 404 대신 보여준다.
// 전체 화면(app/not-found.tsx)은 점검 화면과 같은 뼈대, 팀 안(app/g/[groupId]/not-found.tsx)은 AppShell 안의 타일
import Link from "next/link";
import { Symbol } from "./Logo";
import { Button } from "./ui";

const TITLE = "페이지를 찾을 수 없어요";
/** 탭 제목 (#82). layout.tsx 의 title 템플릿("%s | 언제볼까")과 같은 모양.
 *  잘못된 팀 경로(/g/abc)는 layout 이 notFound() 를 던져 하위 페이지의 metadata("달력" 등)나 Next 기본 404 제목이 남으므로
 *  화면에서 React <title> 로 직접 덮는다 (React 19 가 <head> 로 올린다) */
export const NOT_FOUND_DOC_TITLE = `${TITLE} | 언제볼까`;

export function NotFoundScreen() {
  return (
    <div className="min-h-dvh bg-[var(--login-bg)]">
      <title>{NOT_FOUND_DOC_TITLE}</title>
      <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]">
        <Symbol size={40} />
        <div className="mt-auto pt-16">
          <span className="inline-flex text-[13px] font-bold text-acc-ink">404</span>
          <h1 className="mt-2 break-keep text-[32px] font-bold leading-[1.15] tracking-[-0.03em]">{TITLE}</h1>
          <p className="mt-3 text-[15px] leading-[22px] text-soft">
            주소가 잘못됐거나 사라진 페이지예요
            <br />
            홈에서 내 달력을 다시 열어 보세요
          </p>
        </div>
        <Link href="/" className="mt-8 block">
          <Button size="lg" full tabIndex={-1}>
            홈으로
          </Button>
        </Link>
      </main>
    </div>
  );
}

/** 팀 화면 안(상단 바, 하단 탭은 그대로)에서 쓰는 모양 */
export function GroupNotFound({ calendarHref }: { calendarHref: string }) {
  return (
    <div className="flex min-h-[60dvh] items-center lg:min-h-dvh lg:px-8">
      <title>{NOT_FOUND_DOC_TITLE}</title>
      <div className="mx-auto w-full max-w-[480px] rounded-xl bg-paper px-5 py-7 text-center">
        <h1 className="t-title">{TITLE}</h1>
        <p className="mt-2 text-[14px] leading-5 text-soft">
          주소가 잘못됐거나 이미 삭제된 일정일 수 있어요.
          <br />이 팀 달력에서 다시 찾아 보세요
        </p>
        <Link href={calendarHref} className="mt-6 block">
          <Button size="lg" full tabIndex={-1}>
            달력으로
          </Button>
        </Link>
      </div>
    </div>
  );
}
