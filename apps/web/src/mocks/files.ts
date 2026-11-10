// API_MOCK=1 전용 파일 보관소 (R2 대신). 업로드한 사진 바이트를 메모리에 두고 /api/__mock/files/<id> 로 내준다.
// 실제 API 처럼 profileImageUrl 이 http 경로가 되게 해서, 목 모드에서도 화면이 data: URL 을 보지 않게 한다
import { randomUUID } from "node:crypto";

type StoredFile = { type: string; bytes: Uint8Array };

// dev HMR 로 모듈이 다시 평가돼도 남도록 globalThis 에 둔다 (handler.ts 의 store 와 같은 방식)
const g = globalThis as unknown as { __wwmMockFiles?: Map<string, StoredFile> };
function files(): Map<string, StoredFile> {
  if (!g.__wwmMockFiles) g.__wwmMockFiles = new Map();
  return g.__wwmMockFiles;
}

export const MOCK_FILE_PREFIX = "/api/__mock/files/";

/** 바이트를 보관하고 화면이 쓸 경로를 돌려준다 */
export function putMockFile(type: string, bytes: Uint8Array): string {
  const id = randomUUID();
  files().set(id, { type: type || "application/octet-stream", bytes });
  return `${MOCK_FILE_PREFIX}${id}`;
}

export function getMockFile(id: string): StoredFile | null {
  return files().get(id) ?? null;
}
