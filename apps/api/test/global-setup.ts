import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyTestEnv } from './test-env.js';

/** e2e 시작 전에 테스트 DB 에 마이그레이션을 적용한다 (스키마는 prisma/migrations 그대로) */
export default function globalSetup(): void {
  const url = applyTestEnv();
  if (!/whenwemeet_test|_test\b/.test(new URL(url).pathname)) {
    throw new Error(
      'TEST_DATABASE_URL 은 이름이 _test 로 끝나는 DB 여야 해요 (개발 DB 보호)',
    );
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
