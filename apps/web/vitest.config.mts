import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 순수 함수 단위 테스트가 기본 (앱 감지, .well-known 본문, handoff 형식). 화면 전체 흐름은 dev 서버와 ego-browser 로 확인한다.
// (#314) 상호작용이 핵심인 화면 조각은 `*.test.tsx` 에서 파일 머리 `@vitest-environment happy-dom` + Testing Library 로
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
