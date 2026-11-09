// 서버 전용. 웹 → API 호출의 단일 통로.
// API_MOCK=1 이면 메모리 목(src/mocks)으로, 아니면 `${API_URL}/v1/<path>` 로 전달한다.
import { errorBody } from "./envelope";

export type UpstreamResult = { status: number; body: unknown };

export const isMock = () => process.env.API_MOCK === "1";

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
}): Promise<UpstreamResult> {
  const { method, path, search = "", body = null, contentType = null, token } = opts;

  if (isMock()) {
    const { mockHandle, mockUserFromToken } = await import("@/mocks/handler");
    let parsed: Record<string, unknown> | null = null;
    if (body instanceof ArrayBuffer) {
      // 목은 업로드한 사진을 data URL 로 들고 있는다 (R2 대신)
      const form = await new Response(body, { headers: { "Content-Type": contentType ?? "" } }).formData();
      const file = form.get("file");
      parsed = file instanceof Blob ? { file: { type: file.type, size: file.size, dataUrl: await toDataUrl(file) } } : {};
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
  } catch {
    return {
      status: 502,
      body: errorBody(502, "INTERNAL", "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요"),
    };
  }
}

async function toDataUrl(file: Blob): Promise<string> {
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return `data:${file.type || "application/octet-stream"};base64,${base64}`;
}
