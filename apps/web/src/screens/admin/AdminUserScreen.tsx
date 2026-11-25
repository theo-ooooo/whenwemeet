"use client";
// (#515) 관리자 사용자 상세: 기본 정보와 속한 팀 (역할 바꾸기는 목록에서)
// (#528) 오른쪽 열 속한 팀 아래 "알림 설정" (읽기 전용): 종류별 켜짐/꺼짐(내 정보 > 알림 과 같은 순서, 이름), 그 아래 푸시 기기. 토큰은 받지도 않는다
import Link from "next/link";
import { AdminTitle } from "@/components/admin/AdminShell";
import { Avatar, ErrorState, Skeleton } from "@/components/ui";
import { messageOf, useAdminUser } from "@/hooks";
import { adminDateTime, adminPlatformSeenText, providerText } from "@/lib/admin";
import { NOTIFICATION_KINDS } from "@/lib/notification-kinds";
import type { AdminUserNotifications } from "@/lib/types";
import { PlatformBadges, StatusBadge } from "./AdminMore";
import { InfoRow } from "./HiddenBox";

const PLATFORM_LABEL = { IOS: "iOS", ANDROID: "Android" } as const;

/** (#528) 알림 설정 (읽기 전용). 켜고 끄기는 그 사람의 내 정보 > 알림 에서만 */
function NotificationsSection({ notifications }: { notifications: AdminUserNotifications }) {
  const { settings, devices } = notifications;
  return (
    <section aria-labelledby="admin-user-notifications">
      <h2 id="admin-user-notifications" className="mb-2 mt-6 px-1 text-[13px] font-bold text-ink-2">
        알림 설정
      </h2>
      <ul className="divide-y divide-line rounded-xl bg-paper px-4">
        {NOTIFICATION_KINDS.map((k) => (
          <li key={k.key} className="flex min-h-11 items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{k.label}</span>
            {settings[k.key] ? <StatusBadge tone="on">켜짐</StatusBadge> : <StatusBadge tone="off">꺼짐</StatusBadge>}
          </li>
        ))}
      </ul>
      <h3 className="mb-2 mt-4 px-1 text-[13px] font-bold text-ink-2">푸시 기기 {devices.length}대</h3>
      {devices.length === 0 ? (
        <p className="rounded-xl bg-paper px-4 py-3 text-[14px] text-soft">앱에서 알림을 허용한 기기가 없어 푸시를 받지 않아요</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl bg-paper px-4">
          {devices.map((d, i) => (
            <li key={`${d.platform}-${d.createdAt}-${i}`} className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-0.5 py-2.5">
              <b className="text-[14px] font-semibold">{PLATFORM_LABEL[d.platform]}</b>
              <span className="t-sub">앱 {d.appVersion}</span>
              <span className="t-sub ml-auto shrink-0">마지막 확인 {adminDateTime(d.lastSeenAt)}</span>
              <span className="t-sub basis-full">등록 {adminDateTime(d.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminUserScreen({ id }: { id: number }) {
  const q = useAdminUser(id);
  if (q.error && !q.data)
    return (
      <ErrorState
        message={messageOf(q.error, "사용자를 불러오지 못했어요")}
        onRetry={q.refetch}
      />
    );
  if (!q.data) return <Skeleton className="h-[240px] w-full rounded-xl" />;
  const { user, teams, notifications } = q.data;
  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <Avatar
          member={{
            displayName: user.nickname,
            profileImageUrl: user.profileImageUrl,
          }}
          size={64}
        />
        <div className="min-w-0 flex-1 [&>div]:mb-0">
          <AdminTitle title={user.nickname} sub={`사용자 #${user.id}`} />
        </div>
      </div>
      {/* 넓은 화면은 왼쪽 정보 카드, 오른쪽 속한 팀 */}
      <div className="lg:grid lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <section className="rounded-xl bg-paper px-4 py-3">
          <dl className="divide-y divide-line">
            <InfoRow label="역할">
              {user.role === "admin" ? (
                <StatusBadge tone="warn">관리자</StatusBadge>
              ) : (
                <StatusBadge tone="off">사용자</StatusBadge>
              )}
            </InfoRow>
            <InfoRow label="가입">{adminDateTime(user.createdAt)}</InfoRow>
            <InfoRow label="로그인">{providerText(user.providers)}</InfoRow>
            {/* (#528, #532) 기종마다 앱 버전과 마지막 접속. 접속 기록을 먼저, 없으면 푸시 기기 */}
            <InfoRow label="쓰는 곳">
              <span className="flex flex-wrap items-center gap-1">
                <PlatformBadges platforms={user.platforms} />
              </span>
              {user.platformLastSeen.map((p) => (
                <span key={p.platform} className="t-sub block" title={adminDateTime(p.lastSeenAt)}>
                  {adminPlatformSeenText(p)}
                </span>
              ))}
            </InfoRow>
            <InfoRow label="앱 로그인">{user.lastAppLoginAt ? adminDateTime(user.lastAppLoginAt) : "기록 없음"}</InfoRow>
          </dl>
        </section>
        <div>
          <h2 className="mb-2 mt-4 px-1 text-[13px] font-bold text-ink-2 lg:mt-0">
            속한 팀 {teams.length}개
          </h2>
          <ul className="divide-y divide-line rounded-xl bg-paper px-4">
            {teams.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/admin/teams/${g.id}`}
                  className="flex min-h-12 items-center gap-2 py-2.5 hover:brightness-95"
                >
                  {/* (#528) 개인 달력은 "개인 달력" (이 사람의 것이라 주인 이름은 빼고) */}
                  <b className="min-w-0 truncate text-[14px] font-semibold">
                    {g.type === "PERSONAL" ? "개인 달력" : g.name}
                  </b>
                  {g.type === "TEAM" && <StatusBadge tone="off">팀</StatusBadge>}
                  {g.hidden && <StatusBadge tone="warn">숨김</StatusBadge>}
                  <span className="t-sub ml-auto shrink-0">
                    멤버 {g.memberCount}명, 일정 {g.eventCount}개
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {notifications && <NotificationsSection notifications={notifications} />}
        </div>
      </div>
    </div>
  );
}
