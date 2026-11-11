import { initSentry } from './monitoring/sentry.js';

/** (#185) main.ts 가 맨 앞에서 import 한다. ESM 은 import 순서대로 평가하므로 Nest 모듈보다 먼저 SDK 가 뜬다 */
initSentry();
