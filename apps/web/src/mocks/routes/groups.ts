// 팀 라우트: 내 팀 목록과 만들기, 참여, 팀 정보, 초대 코드, 이 팀의 나 (#491)
import { MEMBER_COLORS } from "@/lib/types";
import { inviteMarkerOf, inviteUrlOf, memberOf, mockGroupCode, type Store } from "../fixtures";
import { err, nextId, nowIso, ok, START_LAST, type AuthedReq, type GroupReq, type MockResult } from "./shared";
import { unread } from "./news";

function groupDetail(s: Store, groupId: number, userId: number) {
  const grp = s.groups.find((x) => x.id === groupId)!;
  const members = s.memberships
    .filter((m) => m.groupId === groupId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map((m) => memberOf(s, groupId, m.userId));
  return {
    id: grp.id,
    type: grp.type,
    name: grp.name,
    inviteCode: grp.inviteCode,
    inviteUrl: grp.inviteCode ? inviteUrlOf(grp.inviteCode) : null,
    inviteShareUrl: grp.inviteCode ? `${inviteUrlOf(grp.inviteCode)}?by=${inviteMarkerOf(groupId, userId)}` : null,
    publicCode: mockGroupCode(grp.id),
    createdAt: grp.createdAt,
    members,
    me: myMember(s, groupId, userId),
  };
}

/** 나 자신의 멤버 정보. (#188) notify 는 내 행에만 싣는다 (7-2) */
function myMember(s: Store, groupId: number, userId: number) {
  const ms = s.memberships.find((m) => m.groupId === groupId && m.userId === userId);
  return { ...memberOf(s, groupId, userId), notify: ms?.notify ?? true, showBirthday: ms?.showBirthday ?? true };
}

function leastUsedColor(s: Store, groupId: number): string {
  const used = s.memberships.filter((m) => m.groupId === groupId).map((m) => m.color);
  let best: string = MEMBER_COLORS[0];
  let bestCount = Infinity;
  for (const c of MEMBER_COLORS) {
    const n = used.filter((u) => u.toUpperCase() === c).length;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

// /groups
export function groupsRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, body, userId } = req;
  if (seg[0] === "groups" && seg.length === 1) {
    if (method === "GET") {
      const mine = s.memberships
        .filter((m) => m.userId === userId)
        .map((m) => ({ m, grp: s.groups.find((x) => x.id === m.groupId)! }))
        .sort((a, b) => {
          if (a.grp.type !== b.grp.type) return a.grp.type === "PERSONAL" ? -1 : 1;
          return a.m.joinedAt.localeCompare(b.m.joinedAt);
        })
        .map(({ m, grp }) => ({
          id: grp.id,
          type: grp.type,
          name: grp.name,
          publicCode: mockGroupCode(grp.id),
          memberCount: s.memberships.filter((x) => x.groupId === grp.id).length,
          me: { color: m.color, displayName: memberOf(s, grp.id, userId).displayName },
          unreadNewsCount: grp.hidden ? 0 : unread(s, grp.id, userId),
          // (#515) 운영 숨김 (D-286)
          hidden: grp.hidden ? { reason: grp.hidden.reason, hiddenAt: grp.hidden.hiddenAt } : null,
        }));
      return ok(mine);
    }
    if (method === "POST") {
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (name.length < 1 || name.length > 30) {
        return err(400, "VALIDATION_FAILED", "팀 이름은 1~30자로 입력해 주세요");
      }
      const id = nextId();
      const code = Array.from({ length: 6 }, () =>
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
      ).join("");
      s.groups.push({ id, type: "TEAM", name, inviteCode: code, createdAt: nowIso() });
      s.memberships.push({
        userId,
        groupId: id,
        color: MEMBER_COLORS[0],
        displayName: null,
        joinedAt: nowIso(),
        lastSeenAt: nowIso(),
      });
      return ok(groupDetail(s, id, userId), 201);
    }
  }
  return null;
}

export function joinRoute(req: AuthedReq): MockResult | null {
  const { s, method, seg, body, userId } = req;
  if (seg[0] === "groups" && seg[1] === "join" && method === "POST") {
    const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    const grp = s.groups.find((x) => x.inviteCode === code && !x.hidden);
    if (!grp) return err(404, "INVITE_NOT_FOUND", "초대 링크가 만료됐거나 잘못됐어요");
    if (!s.memberships.find((m) => m.groupId === grp.id && m.userId === userId)) {
      s.memberships.push({
        userId,
        groupId: grp.id,
        color: leastUsedColor(s, grp.id),
        displayName: null,
        joinedAt: nowIso(),
        lastSeenAt: nowIso(),
      });
    }
    return ok(groupDetail(s, grp.id, userId));
  }
  return null;
}

/** GET, PATCH /groups/:groupId */
export function groupDetailRoute(req: GroupReq): MockResult | null {
  const { s, method, body, userId, groupId, grp, rest } = req;
  if (rest.length === 0) {
    if (method === "GET") return ok(groupDetail(s, groupId, userId));
    if (method === "PATCH") {
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (name.length < 1 || name.length > 30) {
        return err(400, "VALIDATION_FAILED", "팀 이름은 1~30자로 입력해 주세요");
      }
      grp.name = name;
      return ok(groupDetail(s, groupId, userId));
    }
  }
  return null;
}

export function inviteCodeRoute(req: GroupReq): MockResult | null {
  const { method, userId, grp, rest } = req;
  if (rest[0] === "invite-code" && method === "POST") {
    if (grp.type === "PERSONAL") {
      return err(400, "GROUP_NOT_INVITABLE", "개인 달력에는 초대 코드를 만들 수 없어요");
    }
    const code = Array.from({ length: 6 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
    ).join("");
    grp.inviteCode = code;
    return ok({ inviteCode: code, inviteUrl: inviteUrlOf(code), inviteShareUrl: `${inviteUrlOf(code)}?by=${inviteMarkerOf(grp.id, userId)}` });
  }
  return null;
}

/** PATCH, DELETE /groups/:groupId/me */
export function membershipRoute(req: GroupReq): MockResult | null {
  const { s, method, body, userId, groupId, grp, ms, rest } = req;
  if (rest[0] === "me" && rest.length === 1) {
    if (method === "PATCH") {
      if (body && "color" in body) {
        const c = body.color;
        if (typeof c !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(c)) {
          return err(400, "VALIDATION_FAILED", "색 값이 올바르지 않아요");
        }
        ms.color = c;
      }
      if (body && "displayName" in body) {
        const dn = body.displayName;
        if (dn === null || dn === "") ms.displayName = null;
        else if (typeof dn === "string" && dn.trim().length <= 20) ms.displayName = dn.trim();
        else return err(400, "VALIDATION_FAILED", "표시 이름은 20자까지 쓸 수 있어요");
      }
      // (#188) 이 팀 알림 받기
      if (body && "notify" in body) {
        if (typeof body.notify !== "boolean") return err(400, "VALIDATION_FAILED", "notify 는 참/거짓이어야 해요");
        ms.notify = body.notify;
      }
      // (#305) 이 팀 달력에 내 생일 보이기
      if (body && "showBirthday" in body) {
        if (typeof body.showBirthday !== "boolean") return err(400, "VALIDATION_FAILED", "showBirthday 는 true/false 여야 해요");
        ms.showBirthday = body.showBirthday;
      }
      return ok(myMember(s, groupId, userId));
    }
    if (method === "DELETE") {
      if (grp.type === "PERSONAL") {
        return err(400, "GROUP_PERSONAL_LEAVE", "개인 달력은 나갈 수 없어요");
      }
      s.memberships = s.memberships.filter((m) => !(m.groupId === groupId && m.userId === userId));
      // (#300) 고정한 팀에서 나가면 처음 여는 달력은 마지막에 본 달력으로 (D-192)
      const leaver = s.users.find((x) => x.id === userId);
      if (leaver?.startCalendar?.groupId === groupId) leaver.startCalendar = START_LAST;
      // (#248 6장) 그 팀 일정의 내 참여자 행을 지운다. 0 이 되면 "참여자 없음". 로그, 새 소식 없음 (D-139)
      for (const e of s.events) {
        if (e.groupId === groupId && e.participantIds) e.participantIds = e.participantIds.filter((id) => id !== userId);
      }
      // (#189) 그 팀 투표의 내 표와 대상 행
      for (const p of s.polls ?? []) {
        if (p.groupId !== groupId) continue;
        p.participantIds = p.participantIds.filter((id) => id !== userId);
        for (const o of p.options) o.voterIds = o.voterIds.filter((id) => id !== userId);
      }
      const remain = s.memberships.filter((m) => m.groupId === groupId).length;
      if (remain === 0) {
        s.groups = s.groups.filter((x) => x.id !== groupId);
        s.events = s.events.filter((e) => e.groupId !== groupId);
        s.anniversaries = s.anniversaries.filter((a) => a.groupId !== groupId);
        const goneLists = new Set((s.todoLists ?? []).filter((l) => l.groupId === groupId).map((l) => l.id));
        s.todoLists = (s.todoLists ?? []).filter((l) => !goneLists.has(l.id));
        s.todoItems = (s.todoItems ?? []).filter((i) => !goneLists.has(i.listId));
        s.logs = s.logs.filter((l) => l.groupId !== groupId);
        s.polls = (s.polls ?? []).filter((p) => p.groupId !== groupId);
      }
      return ok({ groupDeleted: remain === 0 });
    }
  }
  return null;
}
