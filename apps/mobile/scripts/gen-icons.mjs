// 앱 아이콘/스플래시 PNG 생성기 (#95). 원본은 brand/logo-symbol.svg 의 도형.
// 실행: pnpm --filter @whenwemeet/mobile icons   (결과는 assets/ 에 덮어쓴다, 커밋 대상)
// 크기별 변환(iOS 각 해상도, Android mipmap)은 Expo 가 빌드 때 이 1024 원본에서 한다 (기획 4.7).
import sharp from "sharp";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "..", "assets");
const BRAND = path.join(HERE, "..", "..", "..", "brand");
const BG = "#0F0F10"; // brand/app-icon.svg 배경

// brand/logo-symbol.svg 의 <svg> 안쪽만 꺼낸다 (96 단위 좌표, 중심 48,48)
const SYMBOL = readFileSync(path.join(BRAND, "logo-symbol.svg"), "utf8")
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>[\s\S]*$/, "");

/** 1024 캔버스에 심볼을 ratio(캔버스 대비 심볼 박스 96 의 비율) 크기로 가운데 놓는다 */
function canvas({ ratio, bg, mono = false }) {
  const scale = (1024 * ratio) / 96;
  const t = 512 - 48 * scale;
  let body = SYMBOL;
  // Android 13 테마 아이콘용 단색: 도형은 흰색, 가운데 점은 구멍처럼 보이게 투명
  if (mono) body = body.replace(/fill="#(?!FFFFFF)[0-9A-Fa-f]{6}"/g, 'fill="#FFFFFF"').replace(/<circle[^>]*\/>/, "");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">` +
      (bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : "") +
      `<g transform="translate(${t} ${t}) scale(${scale})">${body}</g></svg>`,
  );
}

async function out(name, svg, { opaque = false } = {}) {
  let img = sharp(svg, { density: 72 * 2 }).resize(1024, 1024);
  if (opaque) img = img.flatten({ background: BG }).removeAlpha();
  await img.png({ compressionLevel: 9 }).toFile(path.join(ASSETS, name));
  console.log("wrote", name);
}

// iOS: 1024 불투명 (투명 불가). 심볼 박스 75% 는 brand/app-icon.svg 와 같은 크기
await out("icon.png", canvas({ ratio: 0.75, bg: BG }), { opaque: true });
// Android 적응형 전경: 안전 영역(지름 66%) 안에 들어오게 심볼 박스 60%
await out("adaptive-icon.png", canvas({ ratio: 0.6 }));
await out("adaptive-icon-monochrome.png", canvas({ ratio: 0.6, mono: true }));
// 스플래시 심볼 (배경색은 app.config.ts 의 splash 설정)
await out("splash-icon.png", canvas({ ratio: 1 }));

// Android 상태 표시줄 알림 아이콘 (#188, 푸시-알림.md 9장): 96×96 흰 단색, 투명 배경.
// 시스템이 알파만 쓰므로 두 사각형은 흰색 하나로 합쳐지고, 가운데 점은 마스크로 뚫어 심볼임을 알아보게 한다
{
  const shapes = SYMBOL.replace(/fill="#[0-9A-Fa-f]{6}"/g, 'fill="#FFFFFF"').replace(/<circle[^>]*\/>/, "");
  const dot = /<circle[^>]*\/>/.exec(SYMBOL)?.[0].replace(/fill="#[0-9A-Fa-f]{6}"/, 'fill="#000000"') ?? "";
  // 심볼 도형은 96 박스 중 8~88 을 쓴다. 상태 표시줄 아이콘 여백(약 4px)만 남기고 꽉 채운다
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="4 4 88 88">` +
      `<mask id="hole"><rect x="0" y="0" width="96" height="96" fill="#FFFFFF"/>${dot}</mask>` +
      `<g mask="url(#hole)">${shapes}</g></svg>`,
  );
  await sharp(svg, { density: 72 * 4 })
    .resize(96, 96)
    .png({ compressionLevel: 9 })
    .toFile(path.join(ASSETS, "notification-icon.png"));
  console.log("wrote notification-icon.png");
}
