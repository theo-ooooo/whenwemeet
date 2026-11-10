// 앱 아이콘 PNG 생성기 (#85 P0). 원본은 brand/logo-symbol.svg 와 같은 도형.
// 실행: pnpm --filter @whenwemeet/web icons   (결과는 public/ 에 덮어쓴다, 커밋 대상)
// sharp 는 의존성으로 추가하지 않고 next 가 이미 가진 것을 빌려 쓴다.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const BG = "#0F0F10";

// 심볼 (96 단위 좌표, 중심 48,48). brand/logo-symbol.svg 와 동일
const SYMBOL = `
  <defs><clipPath id="a"><rect x="8" y="8" width="56" height="56" rx="16"/></clipPath></defs>
  <rect x="8" y="8" width="56" height="56" rx="16" fill="#FF3D1F"/>
  <rect x="32" y="32" width="56" height="56" rx="16" fill="#1F5BFF"/>
  <rect x="32" y="32" width="56" height="56" rx="16" fill="#9A1DFF" clip-path="url(#a)"/>
  <circle cx="48" cy="48" r="5.5" fill="#FFFFFF"/>`;

/**
 * 512 캔버스 SVG.
 * - rounded: true 면 brand/app-icon.svg 처럼 모서리 rx 112 (바깥은 투명)
 * - scale: 심볼 배율. 4 = app-icon.svg 와 같은 크기(심볼이 캔버스의 62.5%)
 */
function svg({ rounded, scale }) {
  const t = 256 - 48 * scale; // 심볼 중심(48,48)을 캔버스 중심에
  const rx = rounded ? 112 : 0;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
      `<rect width="512" height="512" rx="${rx}" fill="${BG}"/>` +
      `<g transform="translate(${t} ${t}) scale(${scale})">${SYMBOL}</g></svg>`,
  );
}

async function out(name, size, opts, { opaque = false } = {}) {
  let img = sharp(svg(opts), { density: 72 * (size / 512) * 4 }).resize(size, size);
  if (opaque) img = img.flatten({ background: BG }).removeAlpha();
  await img.png({ compressionLevel: 9 }).toFile(path.join(PUBLIC, name));
  console.log(name, size);
}

// 일반(any): 둥근 모서리, 바깥 투명 — 브라우저 탭, 설치 대화상자
await out("icon-192.png", 192, { rounded: true, scale: 4 });
await out("icon-512.png", 512, { rounded: true, scale: 4 });
// favicon-32.png, icon.png 은 심볼만(배경 없음) 쓴 기존 파일을 그대로 둔다

// iOS 홈 화면: 투명 금지(검게 채워짐), 모서리는 iOS 가 깎는다 → 꽉 찬 정사각형
await out("apple-touch-icon.png", 180, { rounded: false, scale: 4 }, { opaque: true });

// Android maskable: 가운데 지름 80% 원(반지름 204.8/512) 이 안전 영역.
// 심볼 가장 먼 점(둥근 모서리 바깥) = 중심에서 (24√2 + 16) × scale ≈ 49.9 × scale.
// scale 3.6 → 179.8px (안전 영역의 88%) 로 원형 마스크에서도 잘리지 않는다
await out("icon-maskable-192.png", 192, { rounded: false, scale: 3.6 }, { opaque: true });
await out("icon-maskable-512.png", 512, { rounded: false, scale: 3.6 }, { opaque: true });
