// 시각 문자열 'HH:mm' 도우미 (#67). 24:00 은 "그날 끝(다음 날 0시)" 으로만 쓴다

const pad = (n: number) => String(n).padStart(2, "0");

/** 'HH:mm' → 분. 형식이 아니면 null. 24:00 은 1440 */
export function minutesOf(t: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 1440;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function timeOfMinutes(total: number): string {
  if (total >= 1440) return "24:00";
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** '14:30' → '오후 2:30', '00:00' → '오전 12:00', '12:00' → '오후 12:00', '24:00' → '자정' */
export function formatTimeKo(t: string): string {
  const total = minutesOf(t);
  if (total === null) return t;
  if (total === 1440) return "자정";
  const h = Math.floor(total / 60);
  const min = total % 60;
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${pad(min)}`;
}

/** 직접 입력 해석: '14:30', '1430', '9:05', '905', '9' → 'HH:mm'. 잘못되면 null */
export function parseTimeInput(raw: string, allow24 = false): string | null {
  const s = raw.trim().replace(/\s+/g, "");
  let h: number;
  let min: number;
  let m = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (m) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else if ((m = /^(\d{1,4})$/.exec(s))) {
    const d = m[1];
    if (d.length <= 2) {
      h = Number(d);
      min = 0;
    } else {
      h = Number(d.slice(0, d.length - 2));
      min = Number(d.slice(-2));
    }
  } else {
    return null;
  }
  if (h === 24 && min === 0) return allow24 ? "24:00" : null;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}
