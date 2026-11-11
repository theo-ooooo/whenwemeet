// (#245) [이메일로 계속하기] 보조(테두리) 버튼 (이메일-로그인.md 6-2). 카카오, 애플 버튼과 같은 높이 48, 모서리 12, 아이콘 20 칸.
// 웹뷰 안에서도 그냥 웹 이동이라 앱 셸 버전과 무관하게 동작한다 (네이티브로 가로채지 않음)
import Link from "next/link";
import { IconMail } from "./icons";
import { emailLoginHref } from "@/lib/email-login";

export function EmailLoginButton({ next }: { next: string }) {
  return (
    <Link
      href={emailLoginHref(next)}
      data-email-login
      className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 text-[15px] font-bold leading-5 text-ink hover:brightness-95"
    >
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center">
        <IconMail size={20} />
      </span>
      <span className="truncate">이메일로 계속하기</span>
    </Link>
  );
}
