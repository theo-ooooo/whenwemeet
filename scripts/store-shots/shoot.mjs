// 스토어 스크린샷 원본 캡처 (#247 v4). docs/운영/스토어-제출.md 5.3
// 목 서버(apps/web, API_MOCK=1)를 먼저 띄우고 실행한다:
//   cd apps/web && API_MOCK=1 pnpm dev -p 3205
//   cd scripts/store-shots && npm install && node shoot.mjs [ios69|ios63|play ...]
// 결과: scripts/store-shots/out/raw/<대상>/<n>.png (화면 CSS 크기 × 3, 상태 표시줄 제외)
// Chromium 은 설치된 Google Chrome 을 쓴다 (CHROME_PATH 로 바꿀 수 있음)
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3205";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("./out/raw/", import.meta.url).pathname;

// 화면 CSS 크기. iPhone 은 전체 화면 포인트에서 상태 표시줄(62pt)을 뺀 높이를 웹뷰로 찍는다
export const TARGETS = {
  ios69: { platform: "ios", width: 440, height: 956 - 62 }, // iPhone 17 Pro Max 440×956pt → 1320×2868
  ios63: { platform: "ios", width: 402, height: 874 - 62 }, // iPhone 17 Pro 402×874pt → 1206×2622
  play: { platform: "android", width: 412, height: 847 }, // 1080×1920 안의 720×1480 화면(비율 같음). 412dp 는 흔한 안드로이드 폭이고 아래 독이 넓은 모양(≥390)으로 나온다
  // 아이폰 듀오 (5.4). 바깥 466×678pt 에서 상태 표시줄 66pt, 안쪽 가로 951×669pt 와 세로 669×951pt 에서 24pt
  duoCover: { platform: "ios", width: 466, height: 678 - 66, shots: [1, 3] },
  duoLand: { platform: "ios", width: 951, height: 669 - 24, shots: [1, 2, 5, 7] },
  duoPort: { platform: "ios", width: 669, height: 951 - 24, shots: [1, 2, 5, 7] },
};

const APP_VERSION = "1.4.0"; // 목 최신 버전과 같게 둬서 업데이트 안내 띠가 안 나오게 한다
const BASE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

// 가짜 앱 셸. pushStatus 는 granted, 휴대폰 캘린더 메시지는 apps/web/src/lib/fake-shell.ts 와 같은 모양으로 답한다.
// fake-shell 의 인라인 스크립트는 Chromium 에 따라 안 돌 때가 있어 addInitScript 로 넣는다
function shellScript(platform) {
  return `(() => {
  const SK = "wwm.store-shots.calendar";
  const platform = ${JSON.stringify(platform === "ios" ? "IOS" : "ANDROID")};
  const st = () => { try { const s = JSON.parse(sessionStorage.getItem(SK) || "null"); if (s) return s; } catch {} return { permission: "undetermined", enabled: false, lastSyncedAt: null, count: 0 }; };
  const sv = (s) => sessionStorage.setItem(SK, JSON.stringify(s));
  const emit = (detail) => setTimeout(() => window.dispatchEvent(new CustomEvent("wwm:app", { detail: { v: 1, ...detail } })), 120);
  const cal = (id, s) => emit({ type: "calendarStatus", id, permission: s.permission, canAskAgain: s.permission !== "denied", enabled: s.enabled, lastSyncedAt: s.lastSyncedAt, count: s.count, failed: false });
  window.ReactNativeWebView = { postMessage(data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    const s = st();
    if (m.type === "pushStatus" || m.type === "pushRequest") emit({ type: "pushStatus", id: m.id, permission: "granted", canAskAgain: true, token: "ExponentPushToken[storeshots0000000000000]", platform, appVersion: "${APP_VERSION}" });
    else if (m.type === "calendarSyncStatus") cal(m.id, s);
    else if (m.type === "calendarSyncEnable") { s.permission = "granted"; s.enabled = true; sv(s); cal(m.id, s); }
    else if (m.type === "calendarSyncDisable") { s.enabled = false; s.count = 0; s.lastSyncedAt = null; sv(s); cal(m.id, s); }
    else if (m.type === "calendarSync") { if (s.enabled) { s.count = m.snapshot.events.length; s.lastSyncedAt = new Date().toISOString(); sv(s); } if (m.id) cal(m.id, s); }
  } };
})();`;
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
}

/** 위에 뜬 팝업, 띠가 있으면 실패로 알린다 (찍은 뒤 눈으로도 본다) */
async function checkClean(page, name) {
  const dialogs = await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count();
  if (dialogs > 0) console.warn(`  ! ${name}: 대화 상자 ${dialogs}개가 보인다`);
}

const SHOTS = [
  {
    n: 1,
    name: "홈 달력",
    async run(page) {
      await page.goto(`${BASE}/`);
      await settle(page);
    },
  },
  {
    n: 2,
    name: "빈 시간 찾기",
    async run(page) {
      await page.goto(`${BASE}/free`);
      await settle(page);
    },
  },
  {
    n: 3,
    name: "AI 비서 볼까",
    async run(page) {
      await page.goto(`${BASE}/assistant`);
      await settle(page);
      const input = page.locator("textarea, input[type=text]").last();
      await input.fill("다음 주 금요일 7시 강남에서 저녁 약속 잡아줘");
      await page.getByRole("button", { name: "보내기" }).click();
      await page.getByText("이렇게 넣을까요?").first().waitFor({ timeout: 10_000 });
      await settle(page);
    },
  },
  {
    // 넓은 화면(≥600) 달력 오른쪽 볼까 패널 (AssistantPanel). 듀오 안쪽 화면용
    n: 7,
    name: "AI 볼까 패널",
    async run(page) {
      await page.goto(`${BASE}/`);
      await settle(page);
      await page.getByRole("button", { name: "AI 볼까" }).first().click();
      const input = page.locator("aside textarea, [role=complementary] textarea, textarea").last();
      await input.waitFor({ timeout: 15_000 });
      await input.fill("다음 주 금요일 7시 강남에서 저녁 약속 잡아줘");
      await page.getByRole("button", { name: "보내기" }).last().click();
      await page.getByText("이렇게 넣을까요?").first().waitFor({ timeout: 15_000 });
      await settle(page);
    },
  },
  {
    n: 4,
    name: "휴대폰 캘린더",
    async run(page) {
      await page.goto(`${BASE}/me/device-calendar`);
      await settle(page);
      const sw = page.getByRole("switch").first();
      if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
      await page.waitForTimeout(1500);
      await settle(page);
    },
  },
  {
    n: 5,
    name: "기념일",
    async run(page) {
      await page.goto(`${BASE}/anniversaries`);
      await settle(page);
    },
  },
  {
    n: 6,
    name: "팀 설정 초대",
    async run(page) {
      await page.goto(`${BASE}/team`);
      await settle(page);
      await page.getByRole("button", { name: /^초대하기/ }).click();
      await page.waitForTimeout(1200);
      await settle(page);
    },
  },
];

async function shootTarget(browser, key) {
  const t = TARGETS[key];
  const ua = `${t.platform === "ios" ? BASE_UA : ANDROID_UA} WhenwemeetApp/${APP_VERSION} (${t.platform}) EmailLogin/1 Widget/1 DeviceCalendar/1`;
  const ctx = await browser.newContext({
    viewport: { width: t.width, height: t.height },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
    timezoneId: "Asia/Seoul",
    locale: "ko-KR",
    userAgent: ua,
  });
  await ctx.addInitScript(shellScript(t.platform));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.warn(`  pageerror: ${e.message}`));
  // 목 로그인 뒤 공지 팝업은 닫고 공지는 본 것으로 둔다 (새 공지 띠, 종 빨간 점 없음)
  await page.goto(`${BASE}/auth/kakao?next=/`);
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30_000 });
  await settle(page); // 첫 화면이 마지막 팀 쿠키를 쓰고 난 뒤에 덮어쓴다
  for (const [path, body] of [
    ["/api/notices/2/dismiss", {}],
    ["/api/notices/seen", {}],
    ["/api/me/assistant-consent", {}],
  ]) {
    const r = await page.request.post(`${BASE}${path}`, { data: body });
    if (!r.ok()) console.warn(`  ${path} → ${r.status()}`);
  }
  // 팀 "우리 둘"(목 TEAM_ID 2)을 마지막으로 본 팀으로 둔다
  await ctx.addCookies([{ name: "wwm_group", value: "2", url: BASE }]);
  const only = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
  await mkdir(`${OUT}${key}`, { recursive: true });
  for (const s of SHOTS) {
    if (only && !only.includes(s.n)) continue;
    if (t.shots ? !t.shots.includes(s.n) : s.n > 6) continue;
    await ctx.addCookies([{ name: "wwm_group", value: "2", url: BASE }]);
    try {
      await s.run(page);
    } catch (e) {
      await page.screenshot({ path: `${OUT}${key}/${s.n}-error.png` });
      throw e;
    }
    if (s.n !== 6) await checkClean(page, `${key}/${s.n}`);
    const over = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll("body *")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > w + 0.5 && getComputedStyle(el).position !== "fixed";
      });
      return { w, scroll: document.documentElement.scrollWidth, n: wide.length, first: wide.slice(0, 3).map((el) => `${el.tagName}.${String(el.className).slice(0, 40)} right=${Math.round(el.getBoundingClientRect().right)}`) };
    });
    if (over.scroll > over.w) console.warn(`  ! ${key}/${s.n}: 가로 넘침 scrollWidth ${over.scroll} > ${over.w}`, over.first);
    await page.screenshot({ path: `${OUT}${key}/${s.n}.png`, animations: "disabled", caret: "hide" });
    console.log(`  ${key}/${s.n} ${s.name}`);
  }
  await ctx.close();
}

const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  for (const k of keys) {
    if (!TARGETS[k]) throw new Error(`대상 없음: ${k}`);
    console.log(k);
    await shootTarget(browser, k);
  }
} finally {
  await browser.close();
}
