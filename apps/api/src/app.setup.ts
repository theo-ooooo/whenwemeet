import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** main.ts 와 e2e 테스트가 같은 설정을 쓰도록 분리. CORS 는 WEB_ORIGIN 하나만 (`*` 금지) */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.getOrThrow<string>('WEB_ORIGIN'), credentials: false });
  app.setGlobalPrefix('v1');
  return app;
}
