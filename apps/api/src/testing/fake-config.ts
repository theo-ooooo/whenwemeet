import type { ConfigService } from '@nestjs/config';

/** process.env 와 무관한 ConfigService (단위 테스트 전용). NODE_ENV 같은 값도 이 객체에서만 읽는다 */
export function fakeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => env[key],
    getOrThrow: (key: string) => {
      if (env[key] === undefined) throw new Error(`없음: ${key}`);
      return env[key];
    },
  } as unknown as ConfigService;
}
