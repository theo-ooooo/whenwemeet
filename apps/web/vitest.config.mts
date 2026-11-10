import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 순수 함수 단위 테스트만 (앱 감지, .well-known 본문, handoff 형식). 화면은 dev 서버와 ego-browser 로 확인한다
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
