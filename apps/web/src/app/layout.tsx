import type { Metadata, Viewport } from "next";
import { PushPrompt } from "@/components/PushPrompt";
import { PullRefreshGuard } from "@/components/PullRefreshGuard";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ToastProvider } from "@/components/Toast";
import { SITE_DESCRIPTION, SITE_NAME, SITE_OG_IMAGE, SITE_TITLE, SITE_URL } from "@/lib/site";
import { THEME_SCRIPT } from "@/lib/theme";
import { FAKE_SHELL_SCRIPT } from "@/lib/fake-shell";
import { IN_APP_SCRIPT } from "@/lib/app-bridge";
import "./globals.css";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

export const metadata: Metadata = {
  // 공유 미리보기(카카오톡, 메신저, SNS) (#154). og:image 는 app/og/route.tsx 가 그린다 (#159, #204). 상대 주소를 절대 주소로. 프리뷰 배포에서도 운영 이미지 주소를 쓴다 (카카오 스크래퍼는 운영 주소만 본다)
  metadataBase: new URL(SITE_URL),
  applicationName: "언제볼까",
  title: { default: "언제볼까", template: "%s | 언제볼까" },
  description: SITE_DESCRIPTION,
  // (#413) 구글 Search Console, 네이버 서치어드바이저 소유 확인. 값은 환경 변수(없으면 태그를 넣지 않는다)
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.NAVER_SITE_VERIFICATION ? { "naver-site-verification": process.env.NAVER_SITE_VERIFICATION } : undefined,
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "ko_KR",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SITE_OG_IMAGE],
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION, images: [SITE_OG_IMAGE] },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
  // iOS 홈 화면 추가 (#85 P0). 상태 바는 default: 화면이 상태 바 아래에서 시작하고 글자색은 시스템이 정한다.
  // black-translucent 는 상태 바 글자가 늘 흰색이라 라이트 바탕(#F4F3F1)에서 안 보인다
  appleWebApp: { capable: true, title: "언제볼까", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F3F1" },
    { media: "(prefers-color-scheme: dark)", color: "#121214" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 수동 테마를 첫 페인트 전에 적용 (깜빡임 방지). data-theme 가 서버 HTML 과 달라지므로 html 에 suppressHydrationWarning */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* (#557, D-296) 앱 셸 안이면 첫 페인트 전에 표시. 안전 영역은 셸이 비우므로 웹은 0 (globals.css --sat, --sab) */}
        <script dangerouslySetInnerHTML={{ __html: IN_APP_SCRIPT }} />
        {/* (#549) 목 모드에서만: ?fakeShell=1 이면 앱 셸 흉내 (휴대폰 캘린더 설정을 브라우저에서 확인) */}
        {process.env.API_MOCK === "1" && <script dangerouslySetInnerHTML={{ __html: FAKE_SHELL_SCRIPT }} />}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href={PRETENDARD_CSS} />
      </head>
      <body className="min-h-dvh">
        <ToastProvider>
          {children}
          {/* (#188) 알림 권한 안내 시트. 푸시 지원 앱에서 계기가 올 때만 열린다 (푸시-알림.md 8-1) */}
          <PushPrompt />
          {/* (#203) 브라우저 오프라인 안내와 정적 자산 캐시. 앱 셸에서는 등록하지 않는다 (D-256) */}
          <ServiceWorkerRegister />
          {/* (#419) 앱 셸: 모달, 안쪽 스크롤 영역에서는 당겨서 새로고침을 막도록 셸에 알린다 */}
          <PullRefreshGuard />
        </ToastProvider>
      </body>
    </html>
  );
}
