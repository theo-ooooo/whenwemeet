"use client";
// (#544) 관리자 공지 수정 화면의 "결과" 칸 (D-293). 넓은 화면은 오른쪽 열, 폰은 폼 아래.
//   위: 숫자 칸 여섯(푸시 대상, 전달 성공, 실패, 읽음, 푸시로 연 사람, 읽은 비율)과 푸시 상태 한 줄
//   아래: 읽은 사람 목록(사진, 이름, 읽은 시각, 경로 배지). 이름 검색, 읽음 | 안 읽음(푸시 대상 중) 전환, 읽음은 경로 필터. 더 보기로 이어 읽는다
//   로그인하지 않고 읽은 사람은 셀 수 없다(공개 화면)
import Link from "next/link";
import { useState } from "react";
import { IconSearch } from "@/components/icons";
import { Avatar, ErrorState, Segmented, Skeleton, SkeletonList, inputClass } from "@/components/ui";
import { messageOf, useAdminNoticeReaders, useAdminNoticeStats } from "@/hooks";
import { adminDateTime } from "@/lib/admin";
import { NOTICE_READ_VIAS, NOTICE_VIA_LABEL } from "@/lib/notice";
import { noticePushNote, noticeStatTiles, unreadTargetCount } from "@/lib/notice-stats";
import type { NoticeReader, NoticeReadVia, NoticeStats } from "@/lib/types";
import { AdminMore, StatusBadge } from "./AdminMore";

export function AdminNoticeResults({ id }: { id: number }) {
  const q = useAdminNoticeStats(id);
  return (
    <section aria-labelledby="notice-results-title" className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 id="notice-results-title" className="text-[17px] font-bold">
          결과
        </h2>
        {q.data && (
          <button type="button" onClick={() => void q.refetch()} className="hit ml-auto rounded-sm px-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
            새로 고침
          </button>
        )}
      </div>
      {q.error && !q.data ? (
        <ErrorState message={messageOf(q.error, "결과를 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !q.data ? (
        <Skeleton className="h-[220px] w-full rounded-xl" />
      ) : (
        <Tiles stats={q.data} />
      )}
      <Readers id={id} stats={q.data ?? null} />
    </section>
  );
}

function Tiles({ stats }: { stats: NoticeStats }) {
  const note = noticePushNote(stats);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 fold:grid-cols-3 lg:grid-cols-2">
        {noticeStatTiles(stats).map((t) => (
          <div key={t.label} className="min-h-[84px] rounded-xl bg-paper px-3.5 py-3">
            <span className="block text-[12px] font-semibold leading-4 text-ink-2">{t.label}</span>
            <span className={`mt-1 block text-[22px] font-bold leading-7 tracking-[-0.02em] tabular-nums ${t.warn ? "text-danger" : "text-ink"}`}>{t.value}</span>
            {t.hint && <span className="block text-[11px] leading-4 text-ink-2">{t.hint}</span>}
          </div>
        ))}
      </div>
      {note && <p className="t-sub mt-2">{note}</p>}
    </div>
  );
}

type Mode = "read" | "unread";
const VIA_ALL = "all";

function Readers({ id, stats }: { id: number; stats: NoticeStats | null }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("read");
  const [via, setVia] = useState<NoticeReadVia | typeof VIA_ALL>(VIA_ALL);
  const unreadCount = stats ? unreadTargetCount(stats) : null;
  // 푸시를 보내지 않은 공지는 안 읽은 사람을 고를 수 없다 (전체 사용자를 늘어놓지 않는다)
  const unread = mode === "unread" && unreadCount !== null;
  const q = useAdminNoticeReaders(id, { q: text, via: via === VIA_ALL ? null : via, unread });
  const filtered = text.trim() !== "" || (!unread && via !== VIA_ALL);

  return (
    <div className="rounded-xl bg-paper px-4 py-3">
      <h3 className="text-[15px] font-bold">{unread ? "안 읽은 사람 (푸시 대상)" : "읽은 사람"}</h3>
      <div className="mt-2 space-y-2">
        {unreadCount !== null && stats && (
          <div>
            <span id="notice-readers-mode" className="sr-only">
              읽음, 안 읽음
            </span>
            <Segmented
              labelledBy="notice-readers-mode"
              value={mode}
              options={[
                { value: "read", label: `읽음 ${stats.reads.total.toLocaleString("ko-KR")}` },
                { value: "unread", label: `안 읽음 ${unreadCount.toLocaleString("ko-KR")}` },
              ]}
              onChange={setMode}
            />
          </div>
        )}
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">이름으로 찾기</span>
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
            <input type="search" className={`${inputClass} min-h-10 py-2 pl-9`} placeholder="이름으로 찾기" value={text} maxLength={50} onChange={(e) => setText(e.target.value)} />
          </label>
          {!unread && (
            <label className="block w-[118px] shrink-0">
              <span className="sr-only">경로</span>
              <select className={`${inputClass} min-h-10 py-2`} value={via} onChange={(e) => setVia(e.target.value as NoticeReadVia | typeof VIA_ALL)}>
                <option value={VIA_ALL}>모든 경로</option>
                {NOTICE_READ_VIAS.map((v) => (
                  <option key={v} value={v}>
                    {NOTICE_VIA_LABEL[v]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      {q.error && !q.items ? (
        <div className="mt-3">
          <ErrorState message={messageOf(q.error, "목록을 불러오지 못했어요")} onRetry={q.refetch} />
        </div>
      ) : !q.items ? (
        <div className="mt-2">
          <SkeletonList />
        </div>
      ) : q.items.length === 0 ? (
        <p className="t-sub py-6 text-center">{emptyText(unread, filtered)}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {q.items.map((r) => (
            <ReaderRow key={r.id} r={r} />
          ))}
        </ul>
      )}
      <AdminMore q={q} />
      <p className="t-sub mt-2">로그인하지 않고 읽은 사람은 셀 수 없어요</p>
    </div>
  );
}

function ReaderRow({ r }: { r: NoticeReader }) {
  return (
    <li className="flex min-h-[52px] items-center gap-2.5 py-2">
      <Avatar member={{ displayName: r.nickname, profileImageUrl: r.profileImageUrl }} size={32} />
      <span className="min-w-0 flex-1">
        <Link href={`/admin/users/${r.id}`} className="block truncate text-[14px] font-semibold underline-offset-2 hover:underline">
          {r.nickname}
        </Link>
        <span className="block text-[12px] tabular-nums leading-4 text-ink-2">{r.firstReadAt ? adminDateTime(r.firstReadAt) : "아직 안 읽음"}</span>
      </span>
      {r.via && <StatusBadge tone={r.via === "push" ? "on" : "off"}>{NOTICE_VIA_LABEL[r.via]}</StatusBadge>}
    </li>
  );
}

function emptyText(unread: boolean, filtered: boolean): string {
  if (filtered) return "조건에 맞는 사람이 없어요. 이름이나 경로를 바꿔 보세요";
  return unread ? "푸시 대상은 모두 읽었어요" : "아직 읽은 사람이 없어요";
}
