import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/Toast";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

export const metadata: Metadata = {
  title: { default: "언제볼까", template: "%s | 언제볼까" },
  description: "언제 볼까? 를 달력 하나로. 함께 쓰는 공유 일정",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2F4" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0D" },
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
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
