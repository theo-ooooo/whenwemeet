// 로그인 버튼 아이콘 PNG 생성기 (#145). 웹 KakaoButton, AppleButton 의 SVG path 를 읽어 그대로 그린다.
// react-native-svg 를 넣으면 개발 빌드를 다시 만들어야 해서 PNG(3배, 흰색 단색)로 두고 앱에서 tintColor 로 색을 입힌다.
// 실행: pnpm --filter @whenwemeet/mobile icons   (결과는 assets/login/ 에 덮어쓴다, 커밋 대상)
import sharp from "sharp";
import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "assets", "login");
const WEB = path.join(HERE, "..", "..", "web", "src", "components");

/** 웹 컴포넌트 파일의 첫 <path d="..."> (원본을 한곳에만 둔다) */
const webPath = (file) => readFileSync(path.join(WEB, file), "utf8").match(/<path[^>]*\sd="([^"]+)"/)[1];
const SCALE = 3;

const ICONS = {
  // 웹 KakaoButton: 20x20 상자, viewBox 0 0 24 24
  kakao: {
    w: 20,
    h: 20,
    viewBox: "0 0 24 24",
    d: webPath("KakaoButton.tsx"),
  },
  // 웹 AppleButton: 17x20, viewBox 0 0 17 20
  apple: {
    w: 17,
    h: 20,
    viewBox: "0 0 17 20",
    d: webPath("AppleButton.tsx"),
  },
};

// (#245) 이메일: 웹 components/icons.tsx IconMail 과 같은 선 아이콘(24 격자, 선 1.8, 조각 하나)
const MAIL_SVG = (w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
  `<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M6.5 8.5 12 12.5l5.5-4"/>` +
  `<rect x="10.3" y="11.3" width="3.4" height="3.4" rx="1" transform="rotate(45 12 13)" fill="#FFFFFF" stroke="none"/></svg>`;

mkdirSync(OUT, { recursive: true });
await sharp(Buffer.from(MAIL_SVG(20 * SCALE, 20 * SCALE))).png().toFile(path.join(OUT, "mail@3x.png"));
console.log(`mail@3x.png ${20 * SCALE}x${20 * SCALE}`);
for (const [name, i] of Object.entries(ICONS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${i.w * SCALE}" height="${i.h * SCALE}" viewBox="${i.viewBox}"><path fill="#FFFFFF" d="${i.d}"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, `${name}@3x.png`));
  console.log(`${name}@3x.png ${i.w * SCALE}x${i.h * SCALE}`);
}
