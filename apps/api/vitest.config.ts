import { defineConfig } from 'vitest/config';

/**
 * - unit: `src/**\/*.spec.ts`. DB 없이 돈다 (PrismaService 목)
 * - e2e : `test/**\/*.e2e-spec.ts`. TEST_DATABASE_URL 의 실제 MySQL 을 쓰므로 파일을 순차 실행
 * `pnpm test` 는 unit 만, `pnpm test:e2e` 는 e2e 만, `pnpm test:cov` 는 둘 다 돌려 커버리지를 합친다
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/main.ts', 'src/testing/**', 'src/**/*.spec.ts'],
      reporter: ['text', 'text-summary'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          setupFiles: ['./test/setup-env.ts'],
          globalSetup: ['./test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
