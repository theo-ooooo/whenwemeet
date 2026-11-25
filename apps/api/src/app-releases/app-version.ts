/** (#539) 앱 버전 표기와 비교 (D-292). 웹 lib/app-version.ts 와 같은 규칙. 순수 함수만 */

/** 관리자가 넣는 버전: 숫자 1~3마디 "1", "1.4", "1.4.0" (마디마다 0~9999) */
export const VERSION_PATTERN = /^\d{1,4}(\.\d{1,4}){0,2}$/;

/**
 * 버전 비교. a < b 면 음수, 같으면 0, a > b 면 양수. 마디를 숫자로 비교한다(1.10.0 > 1.9.0), 없는 마디는 0(1.4 = 1.4.0).
 * 앱 UA 의 "1.4.0-beta.1", "1.4.0+12" 같은 꼬리는 버린다. 숫자가 아닌 마디는 0 으로 본다
 */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function parts(v: string): number[] {
  return v
    .trim()
    .split(/[-+]/)[0]
    .split('.')
    .map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
}
