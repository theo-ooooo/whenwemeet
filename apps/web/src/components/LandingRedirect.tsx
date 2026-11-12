"use client";
// (#307) 착지 화면에서 next 로 가는 이동. router.replace 와 Link 는 클라이언트 이동(문서 이동 아님)이라
// Android 브라우저가 앱 링크(/join/.., 옛 /g/..)로 보고 설치된 앱에 넘기지 않는다. window.location 을 쓰지 않는다
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LandingRedirect({ next }: { next: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(next);
  }, [router, next]);
  return (
    <Link
      href={next}
      replace
      prefetch={false}
      className="flex h-12 w-full items-center justify-center rounded-md bg-btn px-5 text-[15px] font-bold leading-5 text-on-btn hover:brightness-95"
    >
      계속하기
    </Link>
  );
}
