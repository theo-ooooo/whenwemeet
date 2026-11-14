// (#404) 공유 미리보기 휴대폰 속 화면: 실제 팀 달력 화면 사진(데모 데이터). satori 는 webp 를 못 읽어 jpg 로 둔다
// fonts.ts 와 같이 nodejs 런타임에서 파일로 읽는다. Vercel 함수에 들어가도록 next.config.ts outputFileTracingIncludes 에 이 폴더를 넣었다
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FILE = join(process.cwd(), "src", "app", "_og", "img", "team-calendar.jpg");

let loading: Promise<string> | null = null;

/** data URL 로 한 번 읽고 프로세스 안에서 재사용 */
export function ogPhoneShot(): Promise<string> {
  loading ??= readFile(FILE)
    .then((b) => `data:image/jpeg;base64,${b.toString("base64")}`)
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
