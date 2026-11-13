import type { Metadata } from "next";
import { headers } from "next/headers";
import { appSupportsAccountLink } from "@/lib/account-link";
import { parseAppUserAgent } from "@/lib/app-bridge";
import { webAppleEnabled } from "@/lib/auth";
import { webEmailEnabled } from "@/lib/email-route";
import { SignInMethodsScreen } from "@/screens/SignInMethodsScreen";

export const metadata: Metadata = { title: "로그인 방법" };
export const dynamic = "force-dynamic";

// (#198) 내 정보 > 로그인 방법 (D-257). 어떤 연결 버튼을 보일지는 요청마다 서버에서 UA 와 스위치로 정한다
export default async function AccountsPage() {
  const ua = (await headers()).get("user-agent");
  const appUa = parseAppUserAgent(ua);
  return (
    <SignInMethodsScreen
      inApp={appUa !== null}
      appLink={appSupportsAccountLink(ua)}
      appleEnabled={webAppleEnabled(process.env.APPLE_LOGIN_ENABLED, appUa?.os)}
      emailEnabled={webEmailEnabled()}
    />
  );
}
