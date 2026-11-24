// (#198) 내 정보 > 로그인 방법 (D-257). 화면, route handler, 목이 같이 쓰는 순수 함수와 문구.
// 연결은 세션(최근 로그인 10분) + 두 번째 로그인의 소유 증명으로만 한다. 자동 병합은 없다
import { APP_EVENT, BRIDGE_VERSION, isAppUserAgent, postToApp } from "./app-bridge";
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
 * 1.2.0 바이너리에 OTA 로 들어간 셸이 카카오 키가 있는 빌드에서 붙인다(D-282). 토큰이 없는 옛 셸은 카카오, Apple 버튼을 숨긴다.
 * 앱 안에서 `/auth/kakao` 로 가면 셸이 네이티브 로그인으로 가로채므로 앱에서는 웹 링크 경로(form POST)를 쓰지 않는다
 */
export const ACCOUNT_LINK_UA_TOKEN = "AccountLink/1";
const ACCOUNT_LINK_UA = /(?:^|\s)AccountLink\/1(?:\s|$)/;

export function appSupportsAccountLink(ua: string | null | undefined): boolean {
  return isAppUserAgent(ua) && ACCOUNT_LINK_UA.test(ua ?? "");
}

/**
 * 연결 버튼을 보일 제공자. 순서 카카오, Apple, 이메일 (D-116).
 * - 앱 셸 안: 카카오, Apple 은 셸이 AccountLink/1 을 알 때만(브리지 linkAccount). 이메일은 웹 화면만으로 끝나 앱에서도 된다
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

/* ---------- (#198) 앱: 셸 브리지 linkAccount (앱.md 4.8, D-282) ---------- */

/** 앱에서 연결하는 제공자. 이메일은 웹 화면만으로 끝난다 */
export type AppLinkProvider = "KAKAO" | "APPLE";

/** 네이티브 로그인 결과. POST /me/auth-accounts 본문에 provider 와 함께 그대로 싣는다 */
export type AppLinkCredentials =
  | { provider: "KAKAO"; credentials: { accessToken: string } }
  | { provider: "APPLE"; credentials: { identityToken: string; authorizationCode: string; nonce: string } };

/** 셸 응답. timeout 은 웹이 기다리다 그만둔 것 (셸이 모르는 메시지로 버렸거나 응답이 오지 않음) */
export type AppLinkOutcome =
  | ({ ok: true } & AppLinkCredentials)
  | { ok: false; reason: "cancelled" | "unavailable" | "error" | "timeout" };

/** 응답 기다리는 시간. 사람이 카카오톡이나 Apple 로그인 시트에서 고르는 동안이라 넉넉히 */
export const APP_LINK_TIMEOUT_MS = 120_000;

/** 1~max 자 문자열 */
function str(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= max;
}

/** wwm:app 이벤트 detail 을 검사해 linkAccount 응답으로 읽는다. 다른 type, 틀린 모양이면 null. 길이는 API DTO 와 같은 한도 */
export function decodeLinkAccountReply(detail: unknown): { id: string; outcome: AppLinkOutcome } | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const o = detail as Record<string, unknown>;
  if (o.v !== BRIDGE_VERSION || o.type !== "linkAccount" || !str(o.id, 40)) return null;
  if (o.ok === false) {
    const reason = o.reason === "cancelled" || o.reason === "unavailable" ? o.reason : "error";
    return { id: o.id, outcome: { ok: false, reason } };
  }
  if (o.ok !== true) return null;
  const c = (o.credentials && typeof o.credentials === "object" ? o.credentials : {}) as Record<string, unknown>;
  if (o.provider === "KAKAO" && str(c.accessToken, 512)) {
    return { id: o.id, outcome: { ok: true, provider: "KAKAO", credentials: { accessToken: c.accessToken } } };
  }
  if (o.provider === "APPLE" && str(c.identityToken, 4096) && str(c.authorizationCode, 512) && str(c.nonce, 128)) {
    return {
      id: o.id,
      outcome: { ok: true, provider: "APPLE", credentials: { identityToken: c.identityToken, authorizationCode: c.authorizationCode, nonce: c.nonce } },
    };
  }
  // 모양이 틀린 성공은 실패로 (같은 id 를 계속 기다리지 않는다)
  return { id: o.id, outcome: { ok: false, reason: "error" } };
}

let linkSeq = 0;
function nextLinkId(): string {
  linkSeq = (linkSeq + 1) % 1_000_000;
  return `l${Date.now().toString(36)}${linkSeq.toString(36)}`;
}

/**
 * 셸에 네이티브 로그인을 부탁하고 같은 id 의 응답을 기다린다 (푸시 requestPushStatus 와 같은 틀).
 * 셸이 아니거나 보내기 실패면 unavailable, 시간 초과면 timeout. 셸은 API 를 부르지 않으므로 연결은 호출부가 세션으로 한다
 */
export function requestAppLink(provider: AppLinkProvider, timeoutMs: number = APP_LINK_TIMEOUT_MS): Promise<AppLinkOutcome> {
  if (typeof window === "undefined") return Promise.resolve({ ok: false, reason: "unavailable" });
  const id = nextLinkId();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (v: AppLinkOutcome) => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener(APP_EVENT, onEvent);
      resolve(v);
    };
    const onEvent = (e: Event) => {
      const r = decodeLinkAccountReply((e as CustomEvent).detail);
      if (r && r.id === id) done(r.outcome);
    };
    window.addEventListener(APP_EVENT, onEvent);
    timer = setTimeout(() => done({ ok: false, reason: "timeout" }), timeoutMs);
    if (!postToApp({ type: "linkAccount", id, provider })) done({ ok: false, reason: "unavailable" });
  });
}

/** 셸 쪽 실패 문구. 취소는 "" (아무것도 띄우지 않음) */
export function appLinkFailureMessage(reason: "cancelled" | "unavailable" | "error" | "timeout", provider: AppLinkProvider): string {
  if (reason === "cancelled") return "";
  if (reason === "unavailable") return linkErrorMessage(`${provider}_NOT_CONFIGURED`, provider);
  return linkErrorMessage(`${provider}_ERROR`, provider);
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
