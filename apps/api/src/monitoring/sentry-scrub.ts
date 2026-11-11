/**
 * (#185) Sentry 로 나가는 오류 이벤트와 브레드크럼에서 개인정보, 비밀값을 지운다 (docs/운영/모니터링.md "거르는 것").
 * SDK 의 `dataCollection` 으로 1차 차단하고, 여기서 한 번 더 지운다(문자열 안에 섞인 이메일, 토큰까지).
 * 웹(`apps/web/src/lib/sentry-scrub.ts`)에 같은 규칙의 사본이 있다. 바꿀 때 둘 다 바꾼다
 */

export const FILTERED = '[Filtered]';

/** 남겨도 되는 요청 헤더 (소문자). 나머지(쿠키, Authorization, X-Internal-Key, X-Client-IP, X-Forwarded-For 등)는 전부 버린다 */
export const ALLOWED_HEADERS = ['accept', 'accept-language', 'content-length', 'content-type', 'host', 'user-agent'] as const;

/** 값을 지우는 쿼리 키. 이름에 이 낱말이 들어가면(대소문자 무시) 값을 `[Filtered]` 로 바꾼다 */
const SENSITIVE_KEY = /token|code|email|key|secret|password|state|session|signature|auth|ticket/i;

/** 객체 키 판정. 쿼리보다 좁게 잡는다(`code` 는 Prisma 오류 코드 같은 진단 정보라 객체에서는 남긴다) */
const SENSITIVE_FIELD = /token|email|secret|password|passwd|authorization|cookie|session|signature|api[-_]?key|private[-_]?key/i;

/** 값이 곧 비밀인 경로 조각. `/join/<초대코드>`, `/invites/<초대코드>`, (#274) `/join/e/<일정 링크 토큰>`, `/event-shares/<토큰>` */
const SECRET_PATH = /(\/(?:join\/e|join|invites|event-shares)\/)[^/?#\s]+/gi;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
/** JWT 처럼 생긴 문자열 (세 조각, 첫 조각이 eyJ) */
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
/** 문자열 안의 `token=...` 꼴 */
const INLINE_PARAM = /\b([A-Za-z_]*(?:token|code|email|key|secret|password|state|session|signature|auth|ticket)[A-Za-z_]*)=([^&\s"'#]+)/gi;

/** 문자열 안의 이메일, Bearer 토큰, JWT, `token=` 꼴 값, 초대코드 경로를 지운다 */
export function redactText(text: string): string {
  return text
    .replace(BEARER, `$1 ${FILTERED}`)
    .replace(JWT, FILTERED)
    .replace(INLINE_PARAM, `$1=${FILTERED}`)
    .replace(SECRET_PATH, `$1${FILTERED}`)
    .replace(EMAIL, FILTERED);
}

/** 쿼리 문자열(`a=1&b=2`, 앞의 `?` 는 있어도 됨)에서 민감한 키의 값을 지운다. 키는 남겨 어떤 요청이었는지는 보이게 한다 */
export function scrubQuery(query: string): string {
  const raw = query.startsWith('?') ? query.slice(1) : query;
  if (!raw) return query;
  const parts = raw.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if (eq < 0) return redactText(pair);
    let decoded = key;
    try {
      decoded = decodeURIComponent(key);
    } catch {
      // 잘못 인코딩된 키는 그대로 판정
    }
    return SENSITIVE_KEY.test(decoded) ? `${key}=${FILTERED}` : redactText(pair);
  });
  return (query.startsWith('?') ? '?' : '') + parts.join('&');
}

/** URL(절대, 상대 모두)의 쿼리와 초대코드 경로를 지운다. 해시는 버린다 */
export function scrubUrl(url: string): string {
  const noHash = url.split('#')[0];
  const q = noHash.indexOf('?');
  const path = redactText(q < 0 ? noHash : noHash.slice(0, q));
  return q < 0 ? path : `${path}${scrubQuery(noHash.slice(q))}`;
}

function scrubHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if ((ALLOWED_HEADERS as readonly string[]).includes(name.toLowerCase()) && typeof value === 'string') out[name] = redactText(value);
  }
  return out;
}

/** 값 안의 문자열을 모두 `redactText` 로. 깊이 5 를 넘는 것은 버린다 */
function deepRedact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value);
  if (depth > 5 || value === null || typeof value !== 'object') return depth > 5 ? FILTERED : value;
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_FIELD.test(k) && typeof v === 'string' ? FILTERED : deepRedact(v, depth + 1);
  return out;
}

interface LooseRequest {
  url?: string;
  query_string?: unknown;
  headers?: unknown;
  cookies?: unknown;
  data?: unknown;
  env?: unknown;
  [key: string]: unknown;
}

interface LooseEvent {
  message?: string;
  logentry?: { message?: string; formatted?: string; params?: unknown[] };
  exception?: { values?: Array<{ value?: string; [key: string]: unknown }> };
  request?: LooseRequest;
  user?: { id?: string | number; [key: string]: unknown };
  breadcrumbs?: LooseBreadcrumb[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  server_name?: string;
  [key: string]: unknown;
}

interface LooseBreadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 요청 정보: URL 쿼리와 경로를 지우고, 헤더는 허용 목록만, 본문, 쿠키, 접속 환경(IP)은 버린다 */
function scrubRequest(request: LooseRequest): LooseRequest {
  const out: LooseRequest = { ...request };
  if (typeof out.url === 'string') out.url = scrubUrl(out.url);
  if (typeof out.query_string === 'string') out.query_string = scrubQuery(out.query_string);
  else if (out.query_string !== undefined) delete out.query_string;
  const headers = scrubHeaders(out.headers);
  if (headers) out.headers = headers;
  else delete out.headers;
  delete out.cookies;
  delete out.data;
  delete out.env;
  return out;
}

/** `beforeBreadcrumb` 용. 콘솔 인자는 버리고, URL 과 문구는 지운다 */
export function scrubBreadcrumb<T extends object>(crumb: T): T {
  const out: LooseBreadcrumb = { ...(crumb as LooseBreadcrumb) };
  if (typeof out.message === 'string') out.message = redactText(out.message);
  if (out.data) {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out.data)) {
      if (k === 'arguments') continue;
      if (typeof v === 'string' && (k === 'url' || k === 'from' || k === 'to')) data[k] = scrubUrl(v);
      else data[k] = deepRedact(v);
    }
    out.data = data;
  }
  return out as unknown as T;
}

/** `beforeSend` 용. 오류 이벤트 하나를 거른다. 사용자 정보는 내부 id 만 남긴다 */
export function scrubEvent<T extends object>(event: T): T {
  const out: LooseEvent = { ...(event as LooseEvent) };
  if (typeof out.message === 'string') out.message = redactText(out.message);
  if (out.logentry) {
    out.logentry = { ...out.logentry };
    if (typeof out.logentry.message === 'string') out.logentry.message = redactText(out.logentry.message);
    if (typeof out.logentry.formatted === 'string') out.logentry.formatted = redactText(out.logentry.formatted);
    if (out.logentry.params) out.logentry.params = deepRedact(out.logentry.params) as unknown[];
  }
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => (typeof v.value === 'string' ? { ...v, value: redactText(v.value) } : v)),
    };
  }
  if (out.request) out.request = scrubRequest(out.request);
  if (out.user) {
    if (out.user.id !== undefined) out.user = { id: out.user.id };
    else delete out.user;
  }
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map((b) => scrubBreadcrumb(b));
  if (out.extra) out.extra = deepRedact(out.extra) as Record<string, unknown>;
  if (out.contexts) out.contexts = deepRedact(out.contexts) as Record<string, unknown>;
  return out as unknown as T;
}
