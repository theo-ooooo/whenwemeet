// 로그인 없이 부르는 공개 라우트 (#491)
import { inviteMarkerOf, memberOf, mockEventCode, mockGroupCode } from "../fixtures";
import { err, ok, type MockResult, type Req } from "./shared";

// 공개(선택 인증): 초대 미리보기. (#196) by 가 현재 멤버 표식이면 inviter, 로그인한 내가 멤버면 isMember + groupId
export function inviteRoute(req: Req): MockResult | null {
  const { s, method, seg, query, ctx } = req;
  if (method === "GET" && seg[0] === "invites" && seg[1]) {
    const code = seg[1].toUpperCase();
    const grp = s.groups.find((x) => x.inviteCode === code && !x.hidden);
    if (!grp) return err(404, "INVITE_NOT_FOUND", "초대 링크가 만료됐거나 잘못됐어요");
    const members = s.memberships.filter((m) => m.groupId === grp.id);
    const by = query.get("by");
    const inviter = by ? members.find((m) => inviteMarkerOf(grp.id, m.userId) === by) : undefined;
    const isMember = ctx.userId !== null && members.some((m) => m.userId === ctx.userId);
    return ok({
      groupName: grp.name,
      memberCount: members.length,
      inviter: inviter ? { nickname: memberOf(s, grp.id, inviter.userId).displayName } : null,
      isMember,
      groupId: isMember ? grp.id : null,
      groupCode: isMember ? mockGroupCode(grp.id) : null,
    });
  }
  return null;
}

// (#274) 공개(선택 인증): 일정 공유 미리보기. 목은 토큰과 상관없이 첫 팀의 첫 일정을 보여 준다 (화면 확인용)
export function eventShareRoute(req: Req): MockResult | null {
  const { s, method, seg, ctx } = req;
  if (method === "GET" && seg[0] === "event-shares" && seg[1] && seg.length === 2) {
    const e = s.events[0];
    const grp = e && s.groups.find((x) => x.id === e.groupId);
    if (!e || !grp) return err(404, "EVENT_SHARE_NOT_FOUND", "링크가 만료됐어요");
    const member = ctx.userId !== null && s.memberships.some((m) => m.groupId === grp.id && m.userId === ctx.userId);
    return ok({
      groupName: grp.name,
      memberCount: s.memberships.filter((m) => m.groupId === grp.id).length,
      sharer: null,
      event: { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, repeat: null, occurrence: null, color: null },
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      viewer: member
        ? { member: true, groupId: grp.id, eventId: e.id, groupCode: mockGroupCode(grp.id), eventCode: mockEventCode(e.id), occurrence: null, date: e.startsAt.slice(0, 10) }
        : { member: false },
    });
  }
  return null;
}
