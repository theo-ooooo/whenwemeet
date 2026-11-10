// 공유 미리보기 이미지(next/og) 용 Pretendard (#159). 원본은 apps/mobile/assets/fonts 와 같은 OTF (SIL OFL, 같은 폴더 LICENSE)
// nodejs 런타임에서 파일로 읽는다. Vercel 함수에 들어가도록 next.config.ts outputFileTracingIncludes 에 이 폴더를 넣었다
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type OgFont = { name: string; data: Buffer; weight: 500 | 700; style: "normal" };

const DIR = join(process.cwd(), "src", "app", "_og", "fonts");

let loading: Promise<OgFont[]> | null = null;

/** 한 번 읽고 프로세스 안에서 재사용 */
export function ogFonts(): Promise<OgFont[]> {
  loading ??= Promise.all([
    readFile(join(DIR, "Pretendard-Medium.otf")).then((data) => ({ name: "Pretendard", data, weight: 500 as const, style: "normal" as const })),
    readFile(join(DIR, "Pretendard-Bold.otf")).then((data) => ({ name: "Pretendard", data, weight: 700 as const, style: "normal" as const })),
  ]).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
