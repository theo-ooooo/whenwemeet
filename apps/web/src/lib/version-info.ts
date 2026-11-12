// (#333) 내 정보 맨 아래 버전 한 줄. 웹 버전, 커밋은 빌드 때 next.config.ts 가 박고, 앱 버전은 셸 UA 에서 읽는다
import { parseAppUserAgent } from "./app-bridge";

export type VersionParts = {
  /** apps/web/package.json 의 version. release PR 이 릴리스 번호로 올린다 (docs/운영/배포.md) */
  webVersion: string;
  /** VERCEL_GIT_COMMIT_SHA. 로컬, CI 빌드처럼 없으면 빈 값 */
  commitSha?: string | null;
  /** 앱 셸 UA(`WhenwemeetApp/<버전>`) 의 버전. 앱이 아니면 null */
  appVersion?: string | null;
};

/** `언제볼까 웹 v0.15.0 (abcdef1), 앱 1.2.0`. 커밋과 앱 버전은 없으면 그 조각을 뺀다 */
export function formatVersionInfo({ webVersion, commitSha, appVersion }: VersionParts): string {
  const sha = commitSha?.trim().slice(0, 7);
  let text = `언제볼까 웹 v${webVersion.trim() || "0.0.0"}`;
  if (sha) text += ` (${sha})`;
  const app = appVersion?.trim();
  if (app) text += `, 앱 ${app}`;
  return text;
}

/** 이 빌드와 이 기기(UA) 의 버전 한 줄. 서버 렌더에는 UA 를 넘기지 않아 앱 조각 없이 그린다 */
export function currentVersionInfo(userAgent: string | null): string {
  return formatVersionInfo({
    webVersion: process.env.NEXT_PUBLIC_WEB_VERSION ?? "",
    commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA,
    appVersion: parseAppUserAgent(userAgent)?.version,
  });
}
