import type { Metadata, Viewport } from "next";
import { PushPrompt } from "@/components/PushPrompt";
import { ToastProvider } from "@/components/Toast";
import { SITE_DESCRIPTION, SITE_NAME, SITE_OG_IMAGE, SITE_TITLE, SITE_URL } from "@/lib/site";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

export const metadata: Metadata = {
  // 공유 미리보기(카카오톡, 메신저, SNS) (#154). og:image 는 app/og/route.tsx 가 그린다 (#159, #204). 상대 주소를 절대 주소로. 프리뷰 배포에서도 운영 이미지 주소를 쓴다 (카카오 스크래퍼는 운영 주소만 본다)
  metadataBase: new URL(SITE_URL),
  applicationName: "언제볼까",
  title: { default: "언제볼까", template: "%s | 언제볼까" },
  description: SITE_DESCRIPTION,
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
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href={PRETENDARD_CSS} />
      </head>
      <body className="min-h-dvh">
        <ToastProvider>
          {children}
          {/* (#188) 알림 권한 안내 시트. 푸시 지원 앱에서 계기가 올 때만 열린다 (푸시-알림.md 8-1) */}
          <PushPrompt />
        </ToastProvider>
      </body>
    </html>
  );
}
