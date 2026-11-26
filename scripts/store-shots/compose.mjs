// 스토어 스크린샷 합성 (#247 v4). docs/운영/스토어-제출.md 5.3
// shoot.mjs 가 찍은 out/raw/<대상>/<n>.png 에 캡션, 상태 표시줄, 기기 테두리를 붙여 docs/store/ 아래에 쓴다.
//   node compose.mjs [ios69 ios63 play duoCover duoLand duoPort]
// 글꼴은 apps/mobile/assets/fonts 의 Pretendard 를 fontconfig 로 등록해 SVG 글자로 그린다.
// 아이폰 듀오 테두리는 Apple Design Resources 베젤(저장소에 넣지 않음)로 만든 v3 이미지
// (docs/store/ios/duo-marketing-v3)에서 화면 구멍과 테두리를 떼어 내 다시 쓴다
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const RAW = path.join(HERE, "out/raw");
const FONT_DIR = path.join(ROOT, "apps/mobile/assets/fonts");

// fontconfig 는 첫 글자를 그릴 때 환경 변수를 읽으므로 sharp 를 부르기 전에 둔다
await mkdir(path.join(HERE, "out"), { recursive: true });
const FC = path.join(HERE, "out/fonts.conf");
await writeFile(
  FC,
  `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${FONT_DIR}</dir><cachedir>${path.join(HERE, "out/fc-cache")}</cachedir><include ignore_missing="yes">/opt/homebrew/etc/fonts/fonts.conf</include></fontconfig>`,
);
process.env.FONTCONFIG_FILE = FC;
const { default: sharp } = await import("sharp");

const BG = { r: 244, g: 243, b: 241 }; // #F4F3F1 (bg)
const INK = "#26252A";
const MUTE = "#6C6C70";
const PRI = "#E0533D";

// 캡션 (docs/운영/스토어-문구.md 5장)
const CAPTIONS = {
  1: ["같이 쓰는 달력 하나로", "커플, 가족, 팀 일정을 한눈에"],
  2: ["모두 비는 시간, 바로 찾기", "기간과 길이만 고르면 후보가 나와요"],
  3: ["말로 하면 일정이 돼요", "볼까가 날짜를 읽고 확인 카드로 보여 줘요"],
  4: ["휴대폰 캘린더에도 그대로", "아이폰, 갤럭시 기본 캘린더에서 바로 봐요"],
  5: ["기념일 D-day 자동 계산", "100일, N주년, 생일을 달력에 표시해요"],
  6: ["링크 하나로 초대", "카카오톡으로 보내면 바로 합류해요"],
  7: ["말로 하면 일정이 돼요", "볼까가 날짜를 읽고 확인 카드로 보여 줘요"],
};
const COVER_CAPTIONS = {
  1: ["접어도 그대로", "커버 화면에서도 달력을 바로 확인해요"],
  3: ["접은 채로 볼까에게", "말하면 확인 카드로 일정이 돼요"],
};
const NAMES = { 1: "calendar", 2: "free", 3: "ai", 4: "device-calendar", 5: "anniv", 6: "invite", 7: "ai" };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** 캡션(코랄 막대, 제목, 보조 문구) SVG. 값은 결과 이미지 픽셀 */
function captionSvg(W, H, c) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect x="${(W - c.barW) / 2}" y="${c.barY}" width="${c.barW}" height="${c.barH}" rx="${c.barH / 2}" fill="${PRI}"/>
  <text x="${W / 2}" y="${c.titleY}" font-family="Pretendard" font-weight="700" font-size="${c.titleSize}" fill="${INK}" text-anchor="middle" letter-spacing="${-c.titleSize * 0.02}">${esc(c.title)}</text>
  <text x="${W / 2}" y="${c.subY}" font-family="Pretendard" font-weight="400" font-size="${c.subSize}" fill="${MUTE}" text-anchor="middle" letter-spacing="${-c.subSize * 0.01}">${esc(c.sub)}</text>
</svg>`);
}

/**
 * iOS 상태 표시줄 (9:41, 신호, 와이파이, 배터리). 단위는 pt, 3배로 그린다.
 * o: { w, h, timeX(가운데), timeAnchor, baseline, font, iconsRight, iconsCY, scale }
 */
function statusBarSvg(o) {
  const s = o.scale ?? 1;
  const g = (x, y) => `translate(${x} ${y}) scale(${s})`;
  // 아이콘 묶음: 신호 17×11, 간격 5, 와이파이 15×11, 간격 5, 배터리 25×12 (+ 꼭지)
  const total = (17 + 5 + 15 + 5 + 27) * s;
  const x0 = o.iconsRight - total;
  const y0 = o.iconsCY - 6 * s;
  const bars = [3, 5.5, 8, 10.5].map((h, i) => `<rect x="${i * 4.5}" y="${11 - h}" width="3" height="${h}" rx="0.9"/>`).join("");
  const wifi = `<path d="M7.5 2.2c2.4 0 4.6.9 6.3 2.4l1.1-1.2C12.9 1.6 10.3.6 7.5.6S2.1 1.6.1 3.4l1.1 1.2C2.9 3.1 5.1 2.2 7.5 2.2z"/><path d="M7.5 5.4c1.5 0 2.9.6 3.9 1.5l1.1-1.2C11.2 4.5 9.4 3.8 7.5 3.8S3.8 4.5 2.5 5.7l1.1 1.2c1-.9 2.4-1.5 3.9-1.5z"/><path d="M7.5 8.4c.7 0 1.3.3 1.8.7L7.5 11 5.7 9.1c.5-.4 1.1-.7 1.8-.7z"/>`;
  const batt = `<rect x="0.5" y="0.5" width="24" height="11" rx="3.2" fill="none" stroke="#000" stroke-opacity="0.38"/><rect x="2" y="2" width="21" height="8" rx="2" /><path d="M26 4v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" fill-opacity="0.4"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${o.w * 3}" height="${o.h * 3}" viewBox="0 0 ${o.w} ${o.h}">
  <text x="${o.timeX}" y="${o.baseline}" font-family="Pretendard" font-weight="700" font-size="${o.font}" fill="#000" text-anchor="${o.timeAnchor ?? "middle"}" letter-spacing="-0.2">9:41</text>
  <g fill="#000">
    <g transform="${g(x0, y0)}">${bars}</g>
    <g transform="${g(x0 + 22 * s, y0)}">${wifi}</g>
    <g transform="${g(x0 + 42 * s, y0 - 0.5 * s)}">${batt}</g>
  </g>
</svg>`);
}

/** 상태 표시줄 + 캡처를 세로로 붙인 화면 원본 (3배 픽셀). 상태 표시줄 바탕은 캡처 맨 윗줄 색을 위로 늘린 것 */
async function screenWithStatus(rawPath, bar) {
  const meta = await sharp(rawPath).metadata();
  const top = await sharp(rawPath).extract({ left: 0, top: 0, width: meta.width, height: 1 }).resize(meta.width, bar.h * 3, { kernel: "nearest" }).png().toBuffer();
  const barPng = await sharp(statusBarSvg(bar)).png().toBuffer();
  return sharp({ create: { width: meta.width, height: meta.height + bar.h * 3, channels: 3, background: BG } })
    .composite([
      { input: top, left: 0, top: 0 },
      { input: barPng, left: 0, top: 0 },
      { input: rawPath, left: 0, top: bar.h * 3 },
    ])
    .png()
    .toBuffer();
}

const roundedMask = (w, h, r) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);

async function writeOut(img, file, kind) {
  await mkdir(path.dirname(file), { recursive: true });
  let p = sharp(img).flatten({ background: BG }).removeAlpha().toColorspace("srgb");
  p = kind === "png" ? p.png({ compressionLevel: 9 }) : p.jpeg({ quality: 92, chromaSubsampling: "4:4:4" });
  await p.toFile(file);
  const m = await sharp(file).metadata();
  console.log(`  ${path.relative(ROOT, file)} ${m.width}×${m.height} ${m.format} alpha=${m.hasAlpha}`);
}

/* ---------- iPhone (6.9", 6.3") ---------- */

const IPHONE = {
  ios69: { W: 1320, H: 2868, pt: [440, 956], out: "docs/store/ios/iphone-v4" },
  ios63: { W: 1206, H: 2622, pt: [402, 874], out: "docs/store/ios/iphone-v4-6.3" },
};

async function composeIphone(key, n) {
  const t = IPHONE[key];
  const k = t.W / 1206; // v3 6.3" 짜임을 기준으로 비율만 키운다
  const [ptW, ptH] = t.pt;
  const sb = 62;
  const earW = (ptW - 126) / 2;
  const screen = await screenWithStatus(path.join(RAW, key, `${n}.png`), {
    w: ptW,
    h: sb,
    timeX: earW / 2 + 4,
    baseline: 35.5,
    font: 17,
    iconsRight: ptW - earW / 2 + 38,
    iconsCY: 29.5,
  });
  const sw = Math.round(900 * k);
  const sh = Math.round((sw * ptH) / ptW);
  const scale = sw / ptW; // pt → 결과 px
  const bezel = Math.round(18 * k);
  const ring = Math.round(5 * k);
  const fw = sw + 2 * (bezel + ring);
  const fh = sh + 2 * (bezel + ring);
  const fx = Math.round((t.W - fw) / 2);
  const fy = Math.round(417 * k);
  const rScreen = Math.round(55 * scale);
  const rOuter = rScreen + bezel + ring;
  const sx = fx + ring + bezel;
  const sy = fy + ring + bezel;
  const di = { w: 126 * scale, h: 37 * scale, y: 11 * scale };
  const screenPng = await sharp(screen)
    .resize(sw, sh, { kernel: "lanczos3" })
    .composite([{ input: roundedMask(sw, sh, rScreen), blend: "dest-in" }])
    .png()
    .toBuffer();
  const btn = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="#8E8D92"/>`;
  const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${t.W}" height="${t.H}">
  ${btn(fx - 4 * k, fy + 230 * k, 6 * k, 70 * k)}${btn(fx - 4 * k, fy + 340 * k, 6 * k, 110 * k)}${btn(fx - 4 * k, fy + 470 * k, 6 * k, 110 * k)}${btn(fx + fw - 2 * k, fy + 380 * k, 6 * k, 170 * k)}
  <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="${rOuter}" fill="#8E8D92"/>
  <rect x="${fx + ring}" y="${fy + ring}" width="${fw - 2 * ring}" height="${fh - 2 * ring}" rx="${rOuter - ring}" fill="#151419"/>
</svg>`);
  const island = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${t.W}" height="${t.H}"><rect x="${t.W / 2 - di.w / 2}" y="${sy + di.y}" width="${di.w}" height="${di.h}" rx="${di.h / 2}" fill="#000"/></svg>`);
  const [title, sub] = CAPTIONS[n];
  const cap = captionSvg(t.W, t.H, { barW: 100 * k, barH: 12 * k, barY: 110 * k, title, titleSize: 82 * k, titleY: 240 * k, sub, subSize: 42 * k, subY: 318 * k });
  const img = await sharp({ create: { width: t.W, height: t.H, channels: 3, background: BG } })
    .composite([
      { input: cap, left: 0, top: 0 },
      { input: frame, left: 0, top: 0 },
      { input: screenPng, left: sx, top: sy },
      { input: island, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  await writeOut(img, path.join(ROOT, t.out, `${n}.jpg`), "jpg");
}

/* ---------- Play 휴대전화 1080×1920 ---------- */

async function composePlay(n) {
  const W = 1080, H = 1920;
  const sw = 720, sh = 1480, sx = 180, sy = 395, bezel = 18, r = 46;
  const screenPng = await sharp(path.join(RAW, "play", `${n}.png`))
    .resize(sw, sh, { kernel: "lanczos3" })
    .composite([{ input: roundedMask(sw, sh, r), blend: "dest-in" }])
    .png()
    .toBuffer();
  const fx = sx - bezel, fy = sy - bezel, fw = sw + 2 * bezel, fh = sh + 2 * bezel;
  const shadow = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="${fx}" y="${fy + 14}" width="${fw}" height="${fh}" rx="${r + bezel}" fill="#000" fill-opacity="0.16"/></svg>`))
    .blur(28)
    .png()
    .toBuffer();
  const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="${r + bezel}" fill="${INK}"/></svg>`);
  const [title, sub] = CAPTIONS[n];
  const cap = captionSvg(W, H, { barW: 86, barH: 10, barY: 96, title, titleSize: 74, titleY: 212, sub, subSize: 42, subY: 290 });
  const img = await sharp({ create: { width: W, height: H, channels: 3, background: BG } })
    .composite([
      { input: cap, left: 0, top: 0 },
      { input: shadow, left: 0, top: 0 },
      { input: frame, left: 0, top: 0 },
      { input: screenPng, left: sx, top: sy },
    ])
    .png()
    .toBuffer();
  await writeOut(img, path.join(ROOT, "docs/store/android/phone-v4", `${n}.png`), "png");
}

/* ---------- 아이폰 듀오 (v3 이미지에서 떼어 낸 Apple 베젤) ---------- */

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/**
 * v3 합성 이미지 여러 장에서 기기 테두리를 떼어 낸다.
 * 모든 장에서 같은 자리가 같은 검은색(화면 둘레 검은 테)이면 벽으로 보고, 화면 가운데에서 벽을 넘지 않고 닿는 곳이 화면 구멍이다.
 * 구멍에 둘러싸인 작은 덩어리(글자, 독 등 v3 화면 내용)는 구멍에 넣고, 구멍 위쪽의 큰 덩어리(바깥 화면 카메라)만 테두리로 남긴다.
 * 결과: 기기 영역 RGBA (구멍은 투명, 테두리 밖 밝은 점은 바탕색) + 구멍 상자
 */
async function extractDevice(files, captionBottom) {
  const imgs = await Promise.all(files.map((f) => sharp(path.join(ROOT, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const { width: W, height: H } = imgs[0].info;
  const N = W * H;
  const a = imgs[0].data;
  const wall = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * 3;
    let ok = true;
    for (const { data } of imgs) {
      if (lum(data, i) >= 50 || Math.abs(a[i] - data[i]) + Math.abs(a[i + 1] - data[i + 1]) + Math.abs(a[i + 2] - data[i + 2]) > 60) { ok = false; break; }
    }
    wall[p] = ok ? 1 : 0;
  }
  const flood = (start, pass) => {
    const mark = new Uint8Array(N);
    const st = [start];
    mark[start] = 1;
    while (st.length) {
      const p = st.pop();
      const x = p % W;
      if (x > 0 && !mark[p - 1] && pass(p - 1)) { mark[p - 1] = 1; st.push(p - 1); }
      if (x < W - 1 && !mark[p + 1] && pass(p + 1)) { mark[p + 1] = 1; st.push(p + 1); }
      if (p >= W && !mark[p - W] && pass(p - W)) { mark[p - W] = 1; st.push(p - W); }
      if (p < N - W && !mark[p + W] && pass(p + W)) { mark[p + W] = 1; st.push(p + W); }
    }
    return mark;
  };
  // 화면 가운데: 캡션 아래 영역의 가운데에서 벽이 아닌 점
  let seed = Math.round((captionBottom + H) / 2) * W + Math.round(W / 2);
  while (wall[seed]) seed += 1;
  const reach = flood(seed, (q) => !wall[q]);
  // 바깥(모서리에서 구멍을 넘지 않고 닿는 곳). 구멍에 둘러싸인 덩어리는 바깥에서 못 닿는다
  const outside = flood(0, (q) => !reach[q]);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let p = 0; p < N; p++) if (reach[p]) {
    const x = p % W, y = (p / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const hole = new Uint8Array(N);
  const cam = new Uint8Array(N);
  const seen = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (reach[p]) { hole[p] = 1; continue; }
    if (outside[p] || seen[p]) continue;
    // 둘러싸인 덩어리
    const comp = [];
    const st = [p]; seen[p] = 1;
    let cy0 = H, cy1 = 0;
    while (st.length) {
      const c = st.pop(); comp.push(c);
      const y = (c / W) | 0; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
      const x = c % W;
      for (const q of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (q >= 0 && q < N && !seen[q] && !reach[q] && !outside[q]) { seen[q] = 1; st.push(q); }
      }
    }
    const camera = comp.length > 2000 && (cy0 + cy1) / 2 < y0 + (y1 - y0) * 0.12;
    for (const q of comp) (camera ? cam : hole)[q] = 1;
  }
  // 모서리 반지름: 상자 모서리에서 대각선으로 들어가 처음 닿는 구멍까지 거리 d, 원이면 r = d / (1 - 1/√2).
  // 바깥 화면은 왼쪽(힌지 쪽)과 오른쪽 모서리가 달라 위쪽 두 모서리를 재서 아래에도 쓴다. 아래 모서리는 v3 글자가 붙어 있어 재지 않는다
  const diag = (cx, cy, dx, dy) => {
    for (let k = 0; k < 400; k++) if (reach[(cy + dy * k) * W + (cx + dx * k)]) return k;
    return 0;
  };
  const rTL = diag(x0, y0, 1, 1) / (1 - Math.SQRT1_2);
  const rTR = diag(x1, y0, -1, 1) / (1 - Math.SQRT1_2);
  // 기기 영역 상자: 캡션 아래에서 바탕과 다른 점 전체
  let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
  for (let y = captionBottom; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, i = p * 3;
    if (hole[p] || Math.abs(a[i] - BG.r) + Math.abs(a[i + 1] - BG.g) + Math.abs(a[i + 2] - BG.b) > 24) {
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
  }
  bx0 = Math.max(0, bx0 - 8); by0 = Math.max(captionBottom, by0 - 8); bx1 = Math.min(W - 1, bx1 + 8); by1 = Math.min(H - 1, by1 + 8);
  const dw = bx1 - bx0 + 1, dh = by1 - by0 + 1;
  // 테두리 층: v3 그대로(구멍 안 옛 화면은 새 화면이 덮는다). 카메라 층: 카메라와 둘레 3px 만
  const out = Buffer.alloc(dw * dh * 4);
  const camOut = Buffer.alloc(dw * dh * 4);
  const near = (p, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (cam[p + dy * W + dx]) return true;
    return false;
  };
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const p = (y + by0) * W + (x + bx0);
    const o = (y * dw + x) * 4;
    const i = p * 3;
    // 바깥의 밝은 점(v3 에서 화면 모서리가 테두리 밖으로 삐져나온 자국)은 바탕색으로
    if (outside[p] && lum(a, i) > 225) { out[o] = BG.r; out[o + 1] = BG.g; out[o + 2] = BG.b; }
    else { out[o] = a[i]; out[o + 1] = a[i + 1]; out[o + 2] = a[i + 2]; }
    out[o + 3] = 255;
    if (!outside[p] && near(p, 3)) { camOut[o] = a[i]; camOut[o + 1] = a[i + 1]; camOut[o + 2] = a[i + 2]; camOut[o + 3] = 255; }
  }
  const raw = { raw: { width: dw, height: dh, channels: 4 } };
  const layer = await sharp(out, raw).png().toBuffer();
  const camera = await sharp(camOut, raw).png().toBuffer();
  return {
    layer,
    camera,
    box: { left: bx0, top: by0, width: dw, height: dh },
    hole: { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
    radii: { tl: rTL, tr: rTR, br: rTR, bl: rTL },
    W,
    H,
  };
}

/** 모서리마다 반지름이 다른 둥근 사각형 마스크 (안티에일리어싱). grow 만큼 키워 검은 테 위로 살짝 덮는다 */
function holeMask(w, h, r, grow = 1.5) {
  const g = (v) => v + grow;
  const d = `M ${-grow + g(r.tl)} ${-grow} H ${w + grow - g(r.tr)} A ${g(r.tr)} ${g(r.tr)} 0 0 1 ${w + grow} ${-grow + g(r.tr)} V ${h + grow - g(r.br)} A ${g(r.br)} ${g(r.br)} 0 0 1 ${w + grow - g(r.br)} ${h + grow} H ${-grow + g(r.bl)} A ${g(r.bl)} ${g(r.bl)} 0 0 1 ${-grow} ${h + grow - g(r.bl)} V ${-grow + g(r.tl)} A ${g(r.tl)} ${g(r.tl)} 0 0 1 ${-grow + g(r.tl)} ${-grow} Z`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible"><path d="${d}" fill="#fff"/></svg>`);
}

const DUO = {
  duoCover: {
    templates: ["docs/store/ios/duo-marketing-v3/cover-1-calendar.jpg", "docs/store/ios/duo-marketing-v3/cover-2-day.jpg"],
    captionBottom: 340,
    pt: [466, 678],
    bar: { h: 66, timeX: 33, timeAnchor: "start", baseline: 44, font: 17, iconsRight: 388, iconsCY: 38 },
    cap: { barW: 120, barH: 13, barY: 104, titleSize: 86, titleY: 228, subSize: 44, subY: 303 },
    captions: COVER_CAPTIONS,
    prefix: "cover",
  },
  duoLand: {
    templates: ["land-1-calendar", "land-2-day", "land-3-free", "land-4-anniv"].map((f) => `docs/store/ios/duo-marketing-v3/${f}.jpg`),
    captionBottom: 380,
    pt: [951, 669],
    bar: { h: 24, timeX: 48, timeAnchor: "start", baseline: 17.5, font: 14, iconsRight: 890, iconsCY: 12, scale: 0.8 },
    cap: { barW: 120, barH: 14, barY: 111, titleSize: 112, titleY: 262, subSize: 58, subY: 350 },
    captions: CAPTIONS,
    prefix: "land",
  },
};

const DUO_ORDER = { duoCover: [1, 3], duoLand: [1, 2, 7, 5], duoPort: [1, 2, 7, 5] };

const deviceCache = {};
async function device(key) {
  const d = key === "duoPort" ? "duoLand" : key;
  deviceCache[d] ??= await extractDevice(DUO[d].templates, DUO[d].captionBottom);
  return deviceCache[d];
}

async function composeDuo(key, n, idx) {
  const portrait = key === "duoPort";
  const spec = DUO[portrait ? "duoLand" : key];
  const dev = await device(key);
  if (process.env.DEBUG_DUO) console.log("  hole", dev.hole, "box", dev.box, "aspect", (dev.hole.width / dev.hole.height).toFixed(4), "want", (spec.pt[0] / spec.pt[1]).toFixed(4));
  const [ptW, ptH] = portrait ? [spec.pt[1], spec.pt[0]] : spec.pt;
  const bar = portrait ? { ...spec.bar, iconsRight: ptW - 61 } : spec.bar;
  const screen = await screenWithStatus(path.join(RAW, key, `${n}.png`), { w: ptW, ...bar });
  let layer = dev.layer, camera = dev.camera, box = dev.box, hole = dev.hole, W = dev.W, H = dev.H, radii = dev.radii;
  let deviceTop = box.top;
  if (portrait) {
    // 안쪽 화면 세로: 가로 테두리를 시계 방향 90도로 돌린다 (책처럼 펴는 기기를 세운 모양)
    layer = await sharp(layer).rotate(90).png().toBuffer();
    camera = await sharp(camera).rotate(90).png().toBuffer();
    radii = { tl: radii.bl, tr: radii.tl, br: radii.tr, bl: radii.br };
    const rel = { x: hole.left - box.left, y: hole.top - box.top };
    hole = { left: box.height - rel.y - hole.height, top: rel.x, width: hole.height, height: hole.width };
    box = { left: 0, top: 0, width: box.height, height: box.width };
    W = 2007; H = 2853;
    const left = Math.round((W - box.width) / 2);
    deviceTop = H - box.height - 120;
    hole = { ...hole, left: hole.left + left, top: hole.top + deviceTop };
    box = { ...box, left, top: deviceTop };
  }
  if (process.env.DEBUG_DUO) console.log("  radii", radii);
  // 구멍 상자보다 1px 씩 크게 그려 검은 테와 사이에 틈이 없게 한다
  const sw = hole.width + 2, sh = hole.height + 2;
  const screenPng = await sharp(screen)
    .resize(sw, sh, { kernel: "lanczos3" })
    .composite([{ input: holeMask(sw, sh, radii, 0.5), blend: "dest-in" }])
    .png()
    .toBuffer();
  const captions = spec.captions[n] ?? CAPTIONS[n];
  const c = portrait ? { barW: 120, barH: 14, barY: 150, titleSize: 112, titleY: 320, subSize: 58, subY: 412 } : spec.cap;
  const cap = captionSvg(W, H, { ...c, title: captions[0], sub: captions[1] });
  const img = await sharp({ create: { width: W, height: H, channels: 3, background: BG } })
    .composite([
      { input: cap, left: 0, top: 0 },
      { input: layer, left: box.left, top: box.top },
      { input: screenPng, left: hole.left - 1, top: hole.top - 1 },
      { input: camera, left: box.left, top: box.top },
    ])
    .png()
    .toBuffer();
  const prefix = portrait ? "port" : spec.prefix;
  await writeOut(img, path.join(ROOT, "docs/store/ios/duo-marketing-v4", `${prefix}-${idx + 1}-${NAMES[n]}.jpg`), "jpg");
}

/* ---------- 실행 ---------- */

const keys = process.argv.slice(2).length ? process.argv.slice(2) : ["ios69", "ios63", "play", "duoCover", "duoLand", "duoPort"];
for (const key of keys) {
  console.log(key);
  if (IPHONE[key]) for (let n = 1; n <= 6; n++) await composeIphone(key, n);
  else if (key === "play") for (let n = 1; n <= 6; n++) await composePlay(n);
  else if (DUO_ORDER[key]) for (const [i, n] of DUO_ORDER[key].entries()) await composeDuo(key, n, i);
  else throw new Error(`대상 없음: ${key}`);
}
