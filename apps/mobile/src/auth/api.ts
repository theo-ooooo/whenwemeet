// 네이티브 로그인 API 호출 (docs/설계/앱.md 3.1, 3.3). 응답 봉투 { status, data, message, error? } (api.md 1장)

export class AuthApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_MESSAGE = "로그인하지 못했어요. 잠시 후 다시 시도해 주세요";

/** POST 후 data.handoff 를 꺼낸다. 형식이 다르면 AuthApiError */
export async function requestHandoff(
  apiOrigin: string,
  path: "/v1/auth/kakao/native" | "/v1/auth/apple/native",
  body: Record<string, string | undefined>,
  fetchFn: Fetch = fetch,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(`${apiOrigin.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthApiError("NETWORK", "인터넷 연결을 확인해 주세요", 0);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // 본문 없음 (게이트웨이 오류 등)
  }
  const env = (json && typeof json === "object" ? json : {}) as {
    data?: { handoff?: unknown } | null;
    message?: unknown;
    error?: { code?: unknown } | null;
  };
  if (!res.ok) {
    const code = typeof env.error?.code === "string" ? env.error.code : `HTTP_${res.status}`;
    const message = typeof env.message === "string" && env.message ? env.message : DEFAULT_MESSAGE;
    throw new AuthApiError(code, message, res.status);
  }
  const handoff = env.data?.handoff;
  if (typeof handoff !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(handoff)) {
    throw new AuthApiError("BAD_RESPONSE", DEFAULT_MESSAGE, res.status);
  }
  return handoff;
}
