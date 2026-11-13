// (D-259) 지도 JS SDK 지연 로더 공통 틀 (카카오 지도 lib/kakao-map.ts, 네이버 지도 lib/naver-map.ts).
// 지도가 필요한 화면(일정 상세의 장소 칸)이 처음 그려질 때만 스크립트를 한 번 붙인다. 키가 없거나, 받지 못하거나,
// 제한 시간 안에 준비되지 않으면 null 이고 다음 호출에 다시 시도한다. 화면은 null 이면 지도 칸을 숨긴다 (D-244)

export const SDK_TIMEOUT_MS = 8_000;
const POLL_MS = 50;

export type SdkSpec<T> = {
  /** 스크립트 주소. 키가 없으면 null (부르지 않는다) */
  url: () => string | null;
  /** 이미 준비된 SDK 객체. 없으면 null */
  current: () => T | null;
  /** 스크립트를 받은 뒤 준비 단계 (카카오는 maps.load). 없으면 current() 가 생길 때까지 기다린다 */
  init?: (done: (value: T | null) => void) => void;
  /** 받기 전 준비 (네이버 인증 실패 콜백 등록) */
  beforeLoad?: () => void;
};

/** SDK 하나의 로더. 돌려준 함수는 여러 번 불러도 스크립트를 한 번만 붙인다 */
export function createSdkLoader<T>(spec: SdkSpec<T>): () => Promise<T | null> {
  let loading: Promise<T | null> | null = null;
  return () => {
    if (typeof window === "undefined") return Promise.resolve(null);
    const url = spec.url();
    if (!url) return Promise.resolve(null);
    const ready = spec.current();
    if (ready) return Promise.resolve(ready);
    if (loading) return loading;
    const p = new Promise<T | null>((resolve) => {
      spec.beforeLoad?.();
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      let poll: ReturnType<typeof setInterval> | null = null;
      const timer = setTimeout(() => done(null), SDK_TIMEOUT_MS);
      let settled = false;
      function done(v: T | null) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (poll) clearInterval(poll);
        if (!v) s.remove();
        resolve(v);
      }
      s.onload = () => {
        if (spec.init) return spec.init(done);
        const now = spec.current();
        if (now) return done(now);
        // 본체가 하위 스크립트를 더 받는 SDK 는 객체가 생길 때까지 기다린다
        poll = setInterval(() => {
          const v = spec.current();
          if (v) done(v);
        }, POLL_MS);
      };
      s.onerror = () => done(null);
      document.head.appendChild(s);
    });
    loading = p;
    void p.then((v) => {
      if (loading === p && v === null) loading = null;
    });
    return p;
  };
}
