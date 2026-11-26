"use client";
// (#537) 관리자 대시보드 (D-290). 관리자 첫 탭(/admin). 기간 7일 | 30일 (주소 ?range=30)
//   위: 숫자 칸(전체 사용자, 기간 가입, 기간 활동, 팀, 개인 달력, 일정, 공지, 신고 대기, 볼까 메시지)
//   아래: 날짜별 막대(가입, 활동, 볼까)와 쓰는 곳 막대. 차트 라이브러리 없이 CSS 막대 (한 계열이라 범례 없음, 제목이 이름)
//   막대마다 마우스를 올리면 날짜와 값(title), 화면 읽기 프로그램은 표(sr-only)로 읽는다
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AdminTitle } from "@/components/admin/AdminShell";
import { ErrorState, Segmented, Skeleton } from "@/components/ui";
import { messageOf, useAdminStats } from "@/hooks";
import { adminDateTime } from "@/lib/admin";
import { barRatios, platformRows, showAxisLabel, statNumber, statsDayLabel, statsRangeOf } from "@/lib/admin-stats";
import type { AdminStats, AdminStatsDay, AdminStatsRange } from "@/lib/types";

const RANGE_OPTIONS: { value: "7" | "30"; label: string }[] = [
  { value: "7", label: "7일" },
  { value: "30", label: "30일" },
];

export function AdminDashboardScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const range = statsRangeOf(params.get("range"));
  const q = useAdminStats(range);

  function setRange(next: AdminStatsRange) {
    router.replace(next === 7 ? pathname : `${pathname}?range=30`);
  }

  const s = q.data && q.data.range === range ? q.data : null;
  return (
    <div>
      <AdminTitle
        title="대시보드"
        sub={s ? `${s.from.replaceAll("-", ".")} ~ ${s.to.replaceAll("-", ".")} (KST), ${adminDateTime(s.generatedAt).slice(11)} 기준` : undefined}
        right={
          <div className="w-[140px] shrink-0">
            <span id="admin-stats-range" className="sr-only">
              기간
            </span>
            <Segmented
              labelledBy="admin-stats-range"
              value={String(range) as "7" | "30"}
              options={RANGE_OPTIONS}
              onChange={(v) => setRange(v === "30" ? 30 : 7)}
            />
          </div>
        }
      />
      {q.error && !s ? (
        <ErrorState message={messageOf(q.error, "지표를 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !s ? (
        <div className="space-y-3" aria-busy="true" aria-label="불러오는 중">
          <Skeleton className="h-[188px] w-full rounded-xl" />
          <Skeleton className="h-[220px] w-full rounded-xl" />
        </div>
      ) : (
        <Dashboard s={s} />
      )}
    </div>
  );
}

function Dashboard({ s }: { s: AdminStats }) {
  const t = s.totals;
  const days = `${s.range}일`;
  return (
    <div className="space-y-4">
      <section aria-label="요약" className="grid grid-cols-2 gap-2 fold:grid-cols-3 lg:grid-cols-5">
        <Tile label="전체 사용자" value={t.users} />
        <Tile label={`가입 (${days})`} value={t.signupsInRange} />
        <Tile label={`활동 사용자 (${days})`} value={t.activeUsers} hint="접속 기록 기준" />
        <Tile label="팀" value={t.teams} hint="개인 달력 제외" />
        <Tile label="개인 달력" value={t.personalCalendars} />
        <Tile label="일정" value={t.events} />
        <Tile label="게시한 공지" value={t.notices} />
        <Tile label={`볼까 메시지 (${days})`} value={t.assistantMessagesInRange} />
        <Tile label="신고 대기" value={t.openReports} href="/admin/reports" warn={t.openReports > 0} />
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        <DayBars title="가입자" unit="명" days={s.days} pick={(d) => d.signups} />
        <DayBars
          title="활동 사용자"
          unit="명"
          days={s.days}
          pick={(d) => d.activeUsers}
          note="그날이 마지막 접속인 사람이에요. 접속 기록은 기종마다 마지막 한 번만 남아 지난 날일수록 적게 보여요"
        />
        <DayBars title="볼까 메시지" unit="번" days={s.days} pick={(d) => d.assistantMessages} sub={(d) => `${d.assistantUsers}명`} />
        <Platforms s={s} />
      </div>
    </div>
  );
}

function Tile({ label, value, hint, href, warn = false }: { label: string; value: number; hint?: string; href?: string; warn?: boolean }) {
  const body = (
    <>
      <span className="block text-[12px] font-semibold leading-4 text-ink-2">{label}</span>
      <span className={`mt-1.5 block text-[24px] font-bold leading-7 tracking-[-0.02em] tabular-nums ${warn ? "text-danger" : "text-ink"}`}>
        {statNumber(value)}
      </span>
      {hint && <span className="mt-0.5 block text-[11px] leading-4 text-ink-2">{hint}</span>}
    </>
  );
  const cls = "block min-h-[92px] rounded-xl bg-paper px-4 py-3";
  return href ? (
    <Link href={href} className={`${cls} hover:brightness-95`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** 날짜별 막대 하나 (한 계열). 막대 위 값은 가장 큰 날과 마지막 날만 */
function DayBars({
  title,
  unit,
  days,
  pick,
  note,
  sub,
}: {
  title: string;
  unit: string;
  days: AdminStatsDay[];
  pick: (d: AdminStatsDay) => number;
  note?: string;
  sub?: (d: AdminStatsDay) => string;
}) {
  const values = days.map(pick);
  const ratios = barRatios(values);
  const max = Math.max(0, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const n = days.length;
  return (
    <section className="rounded-xl bg-paper px-4 py-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-bold">{title}</h2>
        <span className="t-sub tabular-nums">
          합계 {statNumber(total)}
          {unit}
        </span>
      </div>
      {note && <p className="t-sub mt-0.5">{note}</p>}
      <div aria-hidden="true" className="mt-3 flex h-[132px] items-end gap-[2px] border-b border-line">
        {days.map((d, i) => {
          const v = values[i];
          const label = v > 0 && (v === max || i === n - 1);
          return (
            <div
              key={d.day}
              title={`${statsDayLabel(d.day)} ${statNumber(v)}${unit}${sub ? ` (${sub(d)})` : ""}`}
              className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end hover:bg-hover"
            >
              {label && <span className="mb-0.5 whitespace-nowrap text-[10px] font-semibold leading-3 tabular-nums text-ink-2">{statNumber(v)}</span>}
              <span className="block w-full max-w-[28px] rounded-t-[4px] bg-btn" style={{ height: v > 0 ? `max(2px, ${Math.round(ratios[i] * 100)}%)` : 0 }} />
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="mt-1 flex gap-[2px]">
        {days.map((d, i) => (
          <span key={d.day} className="flex min-w-0 flex-1 justify-center overflow-visible whitespace-nowrap text-[10px] leading-3 tabular-nums text-ink-2">
            {showAxisLabel(i, n) ? statsDayLabel(d.day) : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title} 날짜별</caption>
        <thead>
          <tr>
            <th scope="col">날짜</th>
            <th scope="col">{title}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={d.day}>
              <td>{statsDayLabel(d.day)}</td>
              <td>
                {values[i]}
                {unit}
                {sub ? ` (${sub(d)})` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** 쓰는 곳: 기종별 사람 수 가로 막대 (전체 사용자 대비 %, 여러 기종을 쓰면 겹쳐 센다) */
function Platforms({ s }: { s: AdminStats }) {
  const rows = platformRows(s);
  return (
    <section className="rounded-xl bg-paper px-4 py-3">
      <h2 className="text-[15px] font-bold">쓰는 곳</h2>
      <p className="t-sub mt-0.5">전체 사용자 중 그 기종을 쓴 사람이에요. 여러 기종을 쓰면 각각 세요</p>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[96px_minmax(0,1fr)_88px] items-center gap-2">
            <span className="text-[13px] font-semibold">{r.label}</span>
            <span aria-hidden="true" className="block h-3 rounded-[4px] bg-surface">
              <span className="block h-3 rounded-[4px] bg-btn" style={{ width: r.count > 0 ? `max(2px, ${Math.min(100, r.percent)}%)` : 0 }} />
            </span>
            <span className="text-right text-[13px] tabular-nums text-ink-2">
              {statNumber(r.count)}명 ({r.percent}%)
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
