import type { Metadata } from "next";
import Link from "next/link";
import { Symbol } from "@/components/Logo";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/lib/app-open";
import { SITE_OG_IMAGE, SITE_TITLE, SITE_URL } from "@/lib/site";
import { SUPPORT_EMAIL } from "@/lib/support";

// (#407) 소개 페이지. 로그인 안 한 웹 방문자가 맨 / 에서 여기로 온다 (app/route.ts, lib/welcome.ts). 로그인 없이 열린다 (proxy.ts matcher 에 없음)
// 시안 A(소개 첫 화면 + 사진 띠 + 기능 3구역 + 초대 링크 + 마무리). 색은 서비스 토큰(D-57), 글꼴은 루트 layout 의 Pretendard
// 화면 사진은 실제 서비스 캡처(데모 데이터, public/welcome), 사진 띠는 Unsplash 무료 라이선스 (images.unsplash.com/photo-1621359650222-1671b8009383)

const DESCRIPTION = "친구랑 여행 날짜도, 연인이랑 100일도, 가족이랑 병원 일정도. 같이 쓰는 달력이 모두 비는 시간을 찾아줘요";

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: DESCRIPTION,
  // (#413) 로그인 안 한 방문자는 맨 / 에서 이 화면을 본다(proxy rewrite). 검색에는 / 로 올린다
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "언제볼까",
    url: "/",
    title: SITE_TITLE,
    description: "다들 언제 돼? 이 질문, 이제 언제볼까가 대답해요",
    images: [SITE_OG_IMAGE],
  },
};

/** (#413) 검색 결과 구조화 데이터: 웹 앱 하나, 무료, 웹과 iOS, Android */
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "언제볼까",
  alternateName: "whenwemeet",
  url: SITE_URL,
  description: DESCRIPTION,
  applicationCategory: "LifestyleApplication",
  operatingSystem: "Web, iOS, Android",
  inLanguage: "ko",
  offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
  sameAs: [APP_STORE_URL, PLAY_STORE_URL],
};

const WRAP = "mx-auto w-full max-w-[1100px] px-[max(20px,env(safe-area-inset-left))]";
const SECTION = "py-[84px] text-center min-[761px]:py-[120px]";
const BIG = "font-extrabold leading-[1.18] tracking-[-0.05em]";
const SUB = "mt-5 text-[clamp(19px,2.2vw,24px)] leading-normal text-soft";

/** 휴대폰 틀 안에 실제 화면 캡처. 상태 바는 그림으로 그린다 */
function Phone({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div
      className={`relative max-w-[78vw] rounded-[52px] bg-[#111214] p-[9px] shadow-[inset_0_0_0_1.5px_#3a3b40,0_40px_80px_-30px_rgba(25,31,40,0.45)] ${className}`}
    >
      <div className="relative flex aspect-[390/844] flex-col overflow-hidden rounded-[44px] bg-[#f4f3f1]">
        <div
          aria-hidden="true"
          className="relative flex h-[12%] flex-none items-center justify-between pl-[11%] pr-[9%] text-[12px] font-semibold leading-none text-[#111] min-[761px]:text-[14px]"
        >
          <span>9:41</span>
          <i className="absolute left-1/2 top-[22%] h-[34%] w-[30%] -translate-x-1/2 rounded-full bg-black" />
          <span className="flex items-end gap-0.5">
            <b className="h-[5px] w-[3px] rounded-[1px] bg-[#111]" />
            <b className="h-[7px] w-[3px] rounded-[1px] bg-[#111]" />
            <b className="h-[9px] w-[3px] rounded-[1px] bg-[#111]" />
            <em className="ml-[5px] h-[10px] w-[22px] rounded-[3px] border-[1.5px] border-[#111] bg-[#111] shadow-[inset_0_0_0_1.5px_#f4f3f1]" />
          </span>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- public 의 고정 캡처, 크기 변환 불필요 */}
        <img src={src} alt={alt} width={780} height={1688} className="min-h-0 w-full flex-1 object-cover object-top" />
      </div>
    </div>
  );
}

const BADGE =
  "inline-flex h-14 items-center gap-2 rounded-md px-2.5 text-left no-underline max-[600px]:flex-[1_1_calc(50%-5px)] min-[601px]:gap-2.5 min-[601px]:pl-3 min-[601px]:pr-4";

/** 웹으로 시작 + 스토어 두 개. 스토어 버튼은 각 스토어 배지처럼 검은 바탕 */
function StoreBadges({ align, dark = false }: { align: "start" | "center"; dark?: boolean }) {
  const store = `${BADGE} bg-black text-white ${dark ? "shadow-[inset_0_0_0_1px_#5f5f66]" : "shadow-[inset_0_0_0_1px_#a6a6a6]"}`;
  const label = "flex flex-col leading-[1.1]";
  const small = "text-[11px] font-medium tracking-[0.01em]";
  const storeName = "mt-px text-[18px] font-semibold tracking-[-0.02em] min-[601px]:text-[21px]";
  return (
    <div className={`mt-9 flex flex-wrap gap-2.5 ${align === "start" ? "justify-center min-[761px]:justify-start" : "justify-center"}`}>
      <Link href="/login" className={`${BADGE} bg-btn text-on-btn max-[600px]:basis-full max-[600px]:justify-center`}>
        <svg
          className="size-6 flex-none min-[601px]:size-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
        <span className={label}>
          <small className={small}>브라우저에서 바로</small>
          <b className="mt-px text-[18px] font-bold tracking-[-0.02em] min-[601px]:text-[19px]">웹으로 시작</b>
        </span>
      </Link>
      <a href={APP_STORE_URL} className={store}>
        <svg className="size-6 flex-none min-[601px]:size-7" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
        </svg>
        <span className={label}>
          <small className={small}>Download on the</small>
          <b className={storeName}>App Store</b>
        </span>
      </a>
      <a href={PLAY_STORE_URL} className={store}>
        <svg className="size-6 flex-none min-[601px]:size-7" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#00A0FF" d="M3.6 2.3 13 12l-9.4 9.7c-.3-.2-.5-.6-.5-1.1V3.4c0-.5.2-.9.5-1.1z" />
          <path fill="#00D95F" d="M3.6 2.3c.4-.3 1-.3 1.6 0l11 6.3L13 12z" />
          <path fill="#FFCE00" d="M16.2 8.6l3.6 2.1c1 .6 1 2 0 2.6l-3.6 2.1L13 12z" />
          <path fill="#FF3A44" d="M13 12l3.2 3.4-11 6.3c-.6.3-1.2.3-1.6 0z" />
        </svg>
        <span className={label}>
          <small className={small}>GET IT ON</small>
          <b className={storeName}>Google Play</b>
        </span>
      </a>
    </div>
  );
}

/** 기능 구역: 글은 가운데 위, 휴대폰은 아래에서 올라오고 구역 끝에서 잘린다 */
function Feature({ title, gray, sub, shot, alt, band = false }: { title: string; gray: string; sub: string; shot: string; alt: string; band?: boolean }) {
  return (
    <section className={`overflow-hidden pt-[84px] text-center min-[761px]:pt-[120px] ${band ? "bg-surface" : ""}`}>
      <div className={`${WRAP} flex flex-col items-center gap-14`}>
        <div>
          <h2 className={`${BIG} text-[clamp(36px,4.4vw,56px)]`}>
            {title}
            <br />
            <span className="text-ink-2">{gray}</span>
          </h2>
          <p className={SUB}>{sub}</p>
        </div>
        <Phone src={shot} alt={alt} className="-mb-[170px] w-[280px] min-[601px]:-mb-[200px] min-[601px]:w-[320px]" />
      </div>
    </section>
  );
}

export default function WelcomePage() {
  return (
    <div className="min-h-dvh bg-paper text-ink [word-break:keep-all]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <div className={WRAP}>
        <header className="flex items-center gap-[9px] py-4">
          <Symbol size={30} />
          <span className="text-[17px] font-extrabold tracking-[-0.02em]">언제볼까</span>
          <Link href="/login" className="ml-auto text-[15px] font-semibold text-soft no-underline">
            로그인
          </Link>
        </header>
      </div>

      <main>
        <section className="pt-10 text-center min-[761px]:pb-24 min-[761px]:pt-12">
          <div
            className={`${WRAP} grid grid-cols-1 items-center gap-9 min-[761px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] min-[761px]:gap-12 min-[761px]:text-left`}
          >
            <div>
              <h1 className={`${BIG} text-[clamp(48px,6.4vw,84px)]`}>다들 언제 돼?</h1>
              <p className={SUB}>이 질문, 이제 언제볼까가 대답해요</p>
              <StoreBadges align="start" />
            </div>
            <Phone src="/welcome/calendar.webp" alt="팀 달력 화면: 멤버별 색으로 표시된 11월 일정과 진행 중인 투표" className="mx-auto w-[300px]" />
          </div>
        </section>

        <section className="relative h-[460px] overflow-hidden min-[761px]:h-[clamp(380px,52vw,640px)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- public 의 고정 사진 */}
          <img
            src="/welcome/friends.webp"
            alt="바다를 바라보는 친구 세 명의 뒷모습"
            width={1000}
            height={1500}
            className="absolute inset-0 size-full object-cover object-[50%_40%]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.55),transparent_60%)]" />
          <div className={`${WRAP} relative flex h-full items-end py-12`}>
            <p className="text-[clamp(28px,4.4vw,52px)] font-extrabold leading-[1.25] tracking-[-0.04em] text-white">
              친구랑 여행 날짜도,
              <br />
              연인이랑 100일도,
              <br />
              가족이랑 병원 일정도
            </p>
          </div>
        </section>

        <Feature
          title="각자 일정만 적으면"
          gray="모두 되는 시간이 보여요"
          sub="기간과 시간대만 고르면 날짜별로 모아 보여 줘요"
          shot="/welcome/free.webp"
          alt="빈 시간 찾기 화면: 날짜별로 둘 모두 비는 시간 막대와 시간 버튼"
        />
        <Feature
          band
          title="후보만 올리면"
          gray="투표로 정해져요"
          sub="정한 시간은 그대로 모두의 달력에 들어가요"
          shot="/welcome/poll.webp"
          alt="약속 투표 화면: 후보 시간 세 개와 가능한 사람, 이 시간으로 정하기 버튼"
        />
        <Feature
          title="100일도 생일도"
          gray="달력이 먼저 챙겨요"
          sub="처음 만난 날 하나만 적어 두세요"
          shot="/welcome/anniversary.webp"
          alt="기념일 화면: 오늘 처음 만난 날 100일, 하늘 생일 D-3"
        />

        <section className={`${SECTION} bg-surface`}>
          <div className={WRAP}>
            <h2 className={`${BIG} text-[clamp(40px,6.4vw,72px)]`}>
              앱이 없어도
              <br />
              <span className="text-ink-2">링크 하나로 함께해요</span>
            </h2>
            <p className={SUB}>카카오톡으로 초대 링크를 보내면 이 카드가 가요</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- public 의 고정 캡처 */}
            <img
              src="/welcome/invite-preview.webp"
              alt="카카오톡으로 보내는 초대 미리보기 이미지: 우리 가족 팀에 초대받았어요"
              width={1200}
              height={630}
              className="mx-auto mt-14 block h-auto w-[min(640px,100%)] rounded-[24px] bg-[#f4f3f1] shadow-[0_18px_48px_-20px_rgba(25,31,40,0.35)]"
            />
          </div>
        </section>

        <section className={`${SECTION} bg-ink text-surface`}>
          <div className={WRAP}>
            <h2 className={`${BIG} text-[clamp(40px,6.4vw,72px)]`}>
              언제 볼까?
              <br />
              <span className="text-ink-2">이제 달력에서 정해요</span>
            </h2>
            <StoreBadges align="center" dark />
            <p className="mt-[18px] text-[14px] text-ink-2">카카오, Apple, 이메일로 시작해요. 어디서 시작해도 같은 달력이에요.</p>
          </div>
        </section>
      </main>

      <footer className="bg-surface pb-12 pt-11 text-[14px] text-soft">
        <div className={WRAP}>
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <Symbol size={30} />
              <span className="flex flex-col leading-[1.3]">
                <b className="text-[16px] text-ink">언제볼까</b>
                <small className="text-[13px] text-ink-2">같이 쓰는 달력</small>
              </span>
            </div>
            <nav className="flex flex-wrap gap-x-[22px] gap-y-2" aria-label="바닥글">
              <Link href="/support" className="no-underline hover:text-ink">
                고객 지원
              </Link>
              <Link href="/terms" className="no-underline hover:text-ink">
                이용약관
              </Link>
              <Link href="/privacy" className="font-bold text-ink no-underline">
                개인정보처리방침
              </Link>
              <Link href="/policy" className="no-underline hover:text-ink">
                운영정책
              </Link>
            </nav>
          </div>
          <div className="mt-7 flex flex-wrap justify-between gap-2.5 border-t border-line pt-5 text-[13px] text-ink-2">
            <span>
              문의 {SUPPORT_EMAIL}
              <br />© 2026 언제볼까
            </span>
            <span className="flex gap-4">
              <Link href="/login" className="no-underline hover:text-ink">
                웹
              </Link>
              <a href={APP_STORE_URL} className="no-underline hover:text-ink">
                iPhone
              </a>
              <a href={PLAY_STORE_URL} className="no-underline hover:text-ink">
                Android
              </a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
