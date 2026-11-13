// (#198) 내 정보 > 로그인 방법 (D-257). 화면, route handler, 목이 같이 쓰는 순수 함수와 문구.
// 연결은 세션(최근 로그인 10분) + 두 번째 로그인의 소유 증명으로만 한다. 자동 병합은 없다
import { isAppUserAgent } from "./app-bridge";
import { safeNext } from "./auth";

/** 로그인 방법 화면 주소 */
export const ACCOUNTS_PATH = "/me/accounts";
/** 웹 OAuth 연결 시작 (form POST, route handler) */
export const LINK_START_PATH = "/me/link/start";

export type LinkProvider = "KAKAO" | "APPLE" | "EMAIL";
export const LINK_PROVIDERS: readonly LinkProvider[] = ["KAKAO", "APPLE", "EMAIL"];
export const PROVIDER_NAME: Record<string, string> = { KAKAO: "카카오", APPLE: "Apple", EMAIL: "이메일", DEV: "개발" };
/** 조사 붙인 이름 (카카오를, Apple을, 이메일을 / 카카오는, Apple은, 이메일은) */
const WITH_OBJECT: Record<string, string> = { KAKAO: "카카오를", APPLE: "Apple을", EMAIL: "이메일을" };
const WITH_TOPIC: Record<string, string> = { KAKAO: "카카오는", APPLE: "Apple은", EMAIL: "이메일은" };

/**
 * 셸이 UA 끝에 붙이는 능력 표시. 셸이 브리지 `linkAccount` 로 네이티브 카카오, Apple 로그인 결과를 웹에 돌려줄 수 있을 때만.
 * 지금 앱(1.2.x)에는 없다. 앱 안에서 `/auth/kakao` 로 가면 셸이 네이티브 로그인으로 가로채므로 웹 링크 경로는 쓰지 않는다
 */
export const ACCOUNT_LINK_UA_TOKEN = "AccountLink/1";
const ACCOUNT_LINK_UA = /(?:^|\s)AccountLink\/1(?:\s|$)/;

export function appSupportsAccountLink(ua: string | null | undefined): boolean {
  return isAppUserAgent(ua) && ACCOUNT_LINK_UA.test(ua ?? "");
}

/**
 * 연결 버튼을 보일 제공자. 순서 카카오, Apple, 이메일 (D-116).
 * - 앱 셸 안: 카카오, Apple 은 셸이 AccountLink/1 을 알 때만(지금은 없음). 이메일은 웹 화면만으로 끝나 앱에서도 된다
 * - Apple 은 웹 Apple 버튼과 같은 판정(appleEnabled: 스위치 + Android 앱 아님, #145)
 * - 이메일은 이메일 로그인 스위치(D-119)
 * - 이미 연결된 제공자는 빼고 (한 제공자당 하나)
 */
export function linkableProviders(opts: {
  inApp: boolean;
  appLink: boolean;
  appleEnabled: boolean;
  emailEnabled: boolean;
  linked: readonly string[];
}): LinkProvider[] {
  const allowed: Record<LinkProvider, boolean> = {
    KAKAO: !opts.inApp || opts.appLink,
    APPLE: opts.appleEnabled && (!opts.inApp || opts.appLink),
    EMAIL: opts.emailEnabled,
  };
  return LINK_PROVIDERS.filter((p) => allowed[p] && !opts.linked.includes(p));
}

/** 연결 실패 문구. 짧게 */
export function linkErrorMessage(code: string, provider?: string | null): string {
  const name = provider ? PROVIDER_NAME[provider] : undefined;
  switch (code) {
    case "AUTH_ACCOUNT_IN_USE":
      return name ? `이 ${name} 계정은 다른 달력에서 쓰고 있어요` : "이 계정은 다른 달력에서 쓰고 있어요";
    case "PROVIDER_ALREADY_LINKED":
      return `${provider && WITH_TOPIC[provider] ? `${WITH_TOPIC[provider]} ` : ""}이미 연결돼 있어요`;
    case "REAUTH_REQUIRED":
      return "보안을 위해 다시 로그인해 주세요";
    case "LINK_TICKET_INVALID":
    case "OAUTH_STATE":
      return "연결 시간이 지났어요. 다시 시도해 주세요";
    case "APPLE_CANCELLED":
      return "";
    case "KAKAO_ERROR":
      return "카카오 연결에 실패했어요. 잠시 후 다시 시도해 주세요";
    case "APPLE_ERROR":
      return "Apple 연결에 실패했어요. 잠시 후 다시 시도해 주세요";
    case "KAKAO_NOT_CONFIGURED":
    case "APPLE_NOT_CONFIGURED":
      return "지금은 연결할 수 없어요";
    case "LAST_AUTH_ACCOUNT":
      return "마지막 로그인 방법은 해제할 수 없어요";
    default:
      return "연결하지 못했어요. 잠시 후 다시 시도해 주세요";
  }
}

/** 연결 결과 토스트 */
export function linkedMessage(provider: string, absorbed: boolean): string {
  const name = WITH_OBJECT[provider] ?? "로그인 방법을";
  return absorbed ? `${name} 연결하고 빈 계정을 합쳤어요` : `${name} 연결했어요`;
}

/** /me/link 가 결과를 싣고 돌아갈 곳. next 가 규칙 밖이거나 `/` 면 로그인 방법 화면 */
export function linkReturnPath(next: string | null | undefined, result: { linked?: string; absorbed?: boolean; error?: string; provider?: string | null }): string {
  const safe = safeNext(next);
  const base = safe === "/" ? ACCOUNTS_PATH : safe;
  const url = new URL(base, "http://wwm.invalid");
  for (const key of ["linked", "absorbed", "link_error"]) url.searchParams.delete(key);
  if (result.linked) url.searchParams.set("linked", result.linked);
  if (result.absorbed) url.searchParams.set("absorbed", "1");
  if (result.error) url.searchParams.set("link_error", result.error);
  // provider 는 시작할 때 next 에 실어 둔 값을 그대로 둔다(콜백 쪽은 제공자를 모른다)
  if (result.provider) url.searchParams.set("provider", result.provider);
  return `${url.pathname}${url.search}`;
}

/** 화면이 주소에서 읽는 결과 (토스트를 띄우고 주소에서 지운다) */
export function readLinkResult(params: URLSearchParams): { message: string; tone: "ok" | "error" } | null {
  const linked = params.get("linked");
  if (linked) return { message: linkedMessage(linked, params.get("absorbed") === "1"), tone: "ok" };
  const error = params.get("link_error");
  if (!error) return null;
  const message = linkErrorMessage(error, params.get("provider"));
  return message ? { message, tone: "error" } : null;
}

/** 해제 확인 창 문구 */
export function unlinkConfirmBody(provider: string): string {
  // 카카오, Apple(애플), 이메일 모두 받침이 없거나 ㄹ 이라 "로"
  return `${PROVIDER_NAME[provider] ?? "이 방법"}${PROVIDER_NAME[provider] ? "로" : "으로"}는 더 이상 로그인할 수 없어요`;
}
