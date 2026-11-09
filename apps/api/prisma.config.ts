// Prisma 7 설정 (결정기록 D-01). 접속 URL 은 환경 변수로만 읽는다.
// DATABASE_URL 이 없으면 datasource 를 비워 두어 `prisma generate` (CI, 빌드) 는 돌고,
// migrate 류 명령만 실패하게 한다.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(url ? { datasource: { url } } : {}),
});
