// 서버 전용. 웹 → API 호출의 단일 통로.
// API_MOCK=1 이면 메모리 목(src/mocks)으로, 아니면 `${API_URL}/v1/<path>` 로 전달한다.
import { errorBody } from "./envelope";
import { UPSTREAM_UNAVAILABLE } from "./maintenance";

export type UpstreamResult = { status: number; body: unknown };

export const isMock = () => process.env.API_MOCK === "1";

/** API 응답을 기다리는 최대 시간. 넘으면 504 UPSTREAM_UNAVAILABLE (사진 업로드를 고려해 넉넉히) */
const UPSTREAM_TIMEOUT_MS = 15_000;

const UNAVAILABLE_MESSAGE = "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요";

/** fetch 예외가 시간 초과인지 (전체 타임아웃, undici 연결/헤더 타임아웃) */
function isTimeout(e: unknown): boolean {
  const err = e as { name?: string; cause?: { code?: string; name?: string } } | null;
  if (err?.name === "TimeoutError") return true;
  const code = err?.cause?.code;
  return code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || err?.cause?.name === "TimeoutError";
}

export function apiUrl(): string {
  const url = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new Error("API_URL 환경변수가 없어요");
  return url.replace(/\/+$/, "");
}

export async function upstream(opts: {
  method: string;
  path: string; // '/groups' (prefix /v1 제외)
  search?: string; // '?from=...'
  body?: string | ArrayBuffer | null; // JSON 문자열, multipart 면 원본 바이트
  contentType?: string | null; // multipart 일 때만. 없으면 JSON
  token: string | null;
  /** 기다리는 최대 시간(ms). 기본 15초. 로그아웃 기기 해제처럼 실패해도 되는 호출은 짧게 (#188 D-83) */
  timeoutMs?: number;
}): Promise<UpstreamResult> {
  const { method, path, search = "", body = null, contentType = null, token, timeoutMs = UPSTREAM_TIMEOUT_MS } = opts;

  if (isMock()) {
    const { mockHandle, mockUserFromToken } = await import("@/mocks/handler");
    const { putMockFile } = await import("@/mocks/files");
    let parsed: Record<string, unknown> | null = null;
    if (body instanceof ArrayBuffer) {
      // 목은 업로드한 사진을 메모리에 두고 실제 API 처럼 http 경로를 준다 (R2 대신, /api/__mock/files/<id>)
      const form = await new Response(body, { headers: { "Content-Type": contentType ?? "" } }).formData();
      const file = form.get("file");
      parsed =
        file instanceof Blob
          ? { file: { type: file.type, size: file.size, url: putMockFile(file.type, new Uint8Array(await file.arrayBuffer())) } }
          : {};
    } else if (body) {
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        return { status: 400, body: errorBody(400, "VALIDATION_FAILED", "본문을 읽을 수 없어요") };
      }
    }
    return mockHandle({
      method,
      path,
      query: new URLSearchParams(search),
      body: parsed,
      userId: mockUserFromToken(token),
    });
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = contentType ?? "application/json";
  try {
    const res = await fetch(`${apiUrl()}/v1${path}${search}`, {
      method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = errorBody(res.status, "INTERNAL", "잠시 후 다시 시도해 주세요");
      }
    }
    return { status: res.status, body: json };
  } catch (e) {
    // 연결 거부, DNS 실패 등은 502, 시간 초과는 504. 클라이언트와 서버 컴포넌트는 이 코드를 보고 점검 화면으로 보낸다 (#54)
    const status = isTimeout(e) ? 504 : 502;
    return { status, body: errorBody(status, UPSTREAM_UNAVAILABLE, UNAVAILABLE_MESSAGE) };
  }
}

