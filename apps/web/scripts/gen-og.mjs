// 공유 미리보기 이미지(Open Graph 1200x630) 생성기 (#154). 결과: public/og.png (커밋 대상)
// 실행: pnpm --filter @whenwemeet/web og
// 카카오 스크래퍼가 확실히 읽도록 동적 생성(opengraph-image) 대신 정적 PNG 로 둔다.
// 로고는 brand/logo-horizontal.svg (워드마크가 패스라 글꼴 불필요), 문구는 Pretendard OTF(앱 셸에 동봉된 원본, SIL OFL)로
// pango 가 그린다. sharp 는 의존성으로 추가하지 않고 next 가 가진 것을 빌려 쓴다 (gen-icons.mjs 와 같은 방식).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..", "..");
const OUT = path.join(HERE, "..", "public", "og.png");
const FONT_BOLD = path.join(ROOT, "apps", "mobile", "assets", "fonts", "Pretendard-Bold.otf");
const FONT_MEDIUM = path.join(ROOT, "apps", "mobile", "assets", "fonts", "Pretendard-Medium.otf");

const W = 1200;
const H = 630;
const BG = "#F4F3F1"; // --bg (라이트)
const INK = "#26252A"; // --ink
const MUTE = "#6C6C70"; // --mute

// 가로 로고 319x88 → 2.4배
const LOGO_SCALE = 2.4;
const logoSvg = readFileSync(path.join(ROOT, "brand", "logo-horizontal.svg"), "utf8");
const logoW = Math.round(319 * LOGO_SCALE);
const logoH = Math.round(88 * LOGO_SCALE);
const logo = await sharp(Buffer.from(logoSvg), { density: 72 * LOGO_SCALE * 2 })
  .resize(logoW, logoH)
  .png()
  .toBuffer();

async function text(str, { fontfile, family, size, color }) {
  return sharp({
    text: {
      text: `<span foreground="${color}">${str}</span>`,
      font: `${family} ${size}`,
      fontfile,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}

const title = await text("같이 쓰는 달력", { fontfile: FONT_BOLD, family: "Pretendard Bold", size: 60, color: INK });
const sub = await text("모두 비는 시간을 바로 찾아요", {
  fontfile: FONT_MEDIUM,
  family: "Pretendard Medium",
  size: 34,
  color: MUTE,
});

// 세로 배치: 로고 / 간격 40 / 제목 / 간격 16 / 부제. 전체를 세로 가운데에
const gap1 = 40;
const gap2 = 16;
const total = logoH + gap1 + title.info.height + gap2 + sub.info.height;
let y = Math.round((H - total) / 2);
const layers = [];
layers.push({ input: logo, left: Math.round((W - logoW) / 2), top: y });
y += logoH + gap1;
layers.push({ input: title.data, left: Math.round((W - title.info.width) / 2), top: y });
y += title.info.height + gap2;
layers.push({ input: sub.data, left: Math.round((W - sub.info.width) / 2), top: y });

await sharp({ create: { width: W, height: H, channels: 3, background: BG } })
  .composite(layers)
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(OUT);
console.log("og.png", W, H);
