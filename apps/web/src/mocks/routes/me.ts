// /me 아래 라우트: 내 정보, 생일, 처음 여는 달력, 프로필 사진, 로그인 연결, 푸시 기기, 알림 설정 (#491)
import { PUSH_TOKEN_RE } from "@/lib/app-bridge";
import { normalizeReminders } from "@/lib/anniversary-reminder";
import { parseBirthday } from "@/lib/birthday";
import { maskEmail, normalizeEmail } from "@/lib/email-login";
import { errorBody } from "@/lib/envelope";
import { parseId } from "@/lib/id";
import type { AnniversaryReminder, NotificationSettings } from "@/lib/types";
import { ME_ID } from "../fixtures";
import { consumeMockLinkCode } from "../email-login";
import { mockAssistantConsent, mockAssistantMeta } from "../assistant";
import { err, nextId, nowIso, ok, resetStore, START_LAST, type AuthedReq, type MockResult } from "./shared";

/** (#305) GET /me, PATCH /me/birthday 의 birthday */
function birthdayOf(u: { birthday?: string | null; birthdayReminders?: AnniversaryReminder[] }) {
  return { date: u.birthday ?? null, reminders: u.birthdayReminders ?? ["DAY_OF"] };
}

const DEFAULT_NOTIFY: NotificationSettings = { reminder: true, change: true, anniversary: true, join: true, weekly: true, weeklyNudge: false, poll: true };
const NOTIFY_KEYS = Object.keys(DEFAULT_NOTIFY) as (keyof NotificationSettings)[];

/** /me 로 시작하는 요청. 맞는 라우트가 없으면 null (다음 라우트로) */
export function meRoutes(req: AuthedReq): MockResult | null {
  const { s, method, seg, body, userId } = req;
  // /me
  if (seg[0] === "me" && seg.length === 1) {
    const u = s.users.find((x) => x.id === userId)!;
    if (method === "GET") {
      return ok({
        id: u.id,
        nickname: u.nickname,
        profileImageUrl: u.profileImageUrl,
        createdAt: u.createdAt,
        startCalendar: u.startCalendar ?? START_LAST,
        birthday: birthdayOf(u),
        assistant: mockAssistantMeta(s, u.id),
      });
    }
    if (method === "PATCH") {
      const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
      if (nickname.length < 1 || nickname.length > 20) {
        return err(400, "VALIDATION_FAILED", "닉네임은 1~20자여야 해요");
      }
      u.nickname = nickname;
      return ok({ id: u.id, nickname: u.nickname, profileImageUrl: u.profileImageUrl, createdAt: u.createdAt });
    }
    if (method === "DELETE") {
      // 목에서는 탈퇴 처리 대신 성공만 돌려주고 상태는 초기화한다
      resetStore();
      return ok({ ok: true });
    }
  }

  // (#450) AI 비서 처음 안내 동의 (api.md 2.15, 멱등)
  if (seg[0] === "me" && seg[1] === "assistant-consent" && seg.length === 2 && method === "POST") return mockAssistantConsent(s, userId);

  // (#305) /me/birthday (api.md 2.1, D-230). date 는 'MM-DD'(2월 29일 허용) 또는 null, reminders 생략은 그대로
  if (seg[0] === "me" && seg[1] === "birthday" && seg.length === 2 && method === "PATCH") {
    const u = s.users.find((x) => x.id === userId)!;
    const date = body?.date;
    const message = "생일은 MM-DD 형식의 실제 날짜여야 해요";
    if (date !== null && parseBirthday(typeof date === "string" ? date : null) === null) {
      return { status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "date", message }]) };
    }
    if (body && "reminders" in body) {
      const list = body.reminders;
      if (!Array.isArray(list) || list.some((r) => !["DAY_OF", "DAY_BEFORE", "WEEK_BEFORE"].includes(r as string)) || new Set(list).size !== list.length) {
        return err(400, "VALIDATION_FAILED", "알림은 DAY_OF, DAY_BEFORE, WEEK_BEFORE 중에서 골라야 해요");
      }
      u.birthdayReminders = normalizeReminders(list as AnniversaryReminder[]);
    }
    u.birthday = date as string | null;
    return ok(birthdayOf(u));
  }

  // (#300) /me/start-calendar (api.md 2.1, D-191). 짝이 틀리면 400, 내 팀이 아니면 403, 개인 팀은 PERSONAL 로 (400)
  if (seg[0] === "me" && seg[1] === "start-calendar" && seg.length === 2 && method === "PATCH") {
    const u = s.users.find((x) => x.id === userId)!;
    const mode = body?.mode;
    const groupId = body?.groupId ?? null;
    const invalid = (message: string): MockResult => ({ status: 400, body: errorBody(400, "VALIDATION_FAILED", message, [{ field: "groupId", message }]) });
    if (mode !== "LAST" && mode !== "PERSONAL" && mode !== "GROUP") return err(400, "VALIDATION_FAILED", "처음 여는 달력 값이 올바르지 않아요");
    if (groupId !== null && (typeof groupId !== "number" || !Number.isInteger(groupId) || groupId < 1)) return err(400, "VALIDATION_FAILED", "팀 ID 는 정수여야 해요");
    if (mode !== "GROUP") {
      if (groupId !== null) return invalid("팀을 고를 때만 팀 ID 를 보내 주세요");
      u.startCalendar = { mode, groupId: null };
      return ok(u.startCalendar);
    }
    if (groupId === null) return invalid("고정할 팀을 골라 주세요");
    const grp = s.memberships.some((m) => m.userId === userId && m.groupId === groupId) ? s.groups.find((x) => x.id === groupId) : undefined;
    if (!grp) return err(403, "FORBIDDEN", "이 팀의 멤버가 아니에요");
    if (grp.type === "PERSONAL") return invalid('내 달력은 "내 달력" 으로 골라 주세요');
    u.startCalendar = { mode: "GROUP", groupId };
    return ok(u.startCalendar);
  }

  // /me/avatar (api.md 2.1). 목은 업로드한 바이트를 mocks/files.ts 에 두고 /api/__mock/files/<id> 경로를 준다
  if (seg[0] === "me" && seg[1] === "avatar" && seg.length === 2) {
    const u = s.users.find((x) => x.id === userId)!;
    if (method === "POST") {
      const file = body?.file as { type: string; size: number; url: string } | undefined;
      if (!file || !/^image\/(jpeg|png|webp|heic)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
        return err(400, "VALIDATION_FAILED", "jpg, png, webp 10MB 까지 올릴 수 있어요");
      }
      u.profileImageUrl = file.url;
      return ok({ profileImageUrl: u.profileImageUrl });
    }
    if (method === "DELETE") {
      u.profileImageUrl = null;
      return ok({ profileImageUrl: null });
    }
  }

  // (#198) /me/auth-accounts (D-257). 화면 확인용 티켓: mock-KAKAO, mock-APPLE 연결, mock-inuse 409 AUTH_ACCOUNT_IN_USE,
  // mock-absorb 빈 계정 흡수. 이메일은 연결 메일(purpose LINK) 뒤 코드 000000. 해제 실패 확인은 label 에 "fail" 이 든 계정
  if (seg[0] === "me" && seg[1] === "auth-accounts") {
    if (!s.authAccounts) s.authAccounts = [{ id: 9001, userId: ME_ID, provider: "KAKAO", label: "카카오 계정", createdAt: "2026-05-01T00:00:00.000Z" }];
    const order = { KAKAO: 0, APPLE: 1, EMAIL: 2 } as const;
    const mine = () => s.authAccounts!.filter((a) => a.userId === userId).sort((a, b) => order[a.provider] - order[b.provider]);
    const view = (a: NonNullable<typeof s.authAccounts>[number]) => ({ id: a.id, provider: a.provider, label: a.label, createdAt: a.createdAt });
    const add = (provider: "KAKAO" | "APPLE" | "EMAIL", label: string, absorbed = false): MockResult => {
      if (mine().some((a) => a.provider === provider)) return err(409, "PROVIDER_ALREADY_LINKED", "이미 연결된 로그인 방법이에요");
      const row = { id: nextId(), userId, provider, label, createdAt: nowIso() };
      s.authAccounts!.push(row);
      return ok({ account: view(row), absorbed });
    };
    if (seg.length === 2 && method === "GET") return ok(mine().map(view));
    if (seg.length === 3 && seg[2] === "link-start" && method === "POST") {
      const provider = body?.provider;
      if (provider !== "KAKAO" && provider !== "APPLE") return err(400, "VALIDATION_FAILED", "provider 는 KAKAO 또는 APPLE 이어야 해요");
      if (mine().some((a) => a.provider === provider)) return err(409, "PROVIDER_ALREADY_LINKED", "이미 연결된 로그인 방법이에요");
      return ok({ intent: "mock", expiresIn: 600 });
    }
    if (seg.length === 2 && method === "POST") {
      const ticket = body?.ticket;
      if (typeof ticket === "string") {
        if (ticket === "mock-KAKAO") return add("KAKAO", "카카오 계정");
        if (ticket === "mock-APPLE") return add("APPLE", "Apple ID");
        if (ticket === "mock-absorb") return add("APPLE", "Apple ID", true);
        if (ticket === "mock-inuse") return err(409, "AUTH_ACCOUNT_IN_USE", "이 로그인으로 만든 다른 계정이 있어요");
        return err(400, "LINK_TICKET_INVALID", "연결 시간이 지났어요. 다시 시도해 주세요");
      }
      if (body?.provider === "EMAIL" && typeof body.email === "string" && typeof body.code === "string") {
        const failed = consumeMockLinkCode(body.email, body.code);
        if (failed) return failed;
        return add("EMAIL", maskEmail(normalizeEmail(body.email)));
      }
      return err(400, "VALIDATION_FAILED", "ticket 또는 provider 중 하나만 보내 주세요");
    }
    if (seg.length === 3 && method === "DELETE") {
      const id = parseId(seg[2]);
      const row = mine().find((a) => a.id === id);
      if (!row) return err(404, "NOT_FOUND", "찾을 수 없어요");
      if (mine().length <= 1) return err(409, "LAST_AUTH_ACCOUNT", "마지막 로그인 방법은 해제할 수 없어요");
      if (row.label.includes("fail")) return err(502, row.provider === "APPLE" ? "APPLE_ERROR" : "KAKAO_ERROR", "연결에 실패했어요");
      s.authAccounts = s.authAccounts!.filter((a) => a.id !== id);
      return ok({ ok: true });
    }
  }

  // (#188) /me/push-devices (7-1). 토큰으로 upsert, 다른 사용자 행이면 나로 옮긴다. 한 사용자 10대
  if (seg[0] === "me" && seg[1] === "push-devices" && seg.length === 2) {
    const devices = (s.pushDevices ??= []);
    const token = body?.token;
    if (typeof token !== "string" || !PUSH_TOKEN_RE.test(token)) {
      return { status: 400, body: errorBody(400, "VALIDATION_FAILED", "푸시 토큰 형식이 올바르지 않아요", [{ field: "token", message: "푸시 토큰 형식이 올바르지 않아요" }]) };
    }
    if (method === "PUT") {
      const platform = body?.platform;
      const appVersion = body?.appVersion;
      if (platform !== "IOS" && platform !== "ANDROID") return err(400, "VALIDATION_FAILED", "platform 은 IOS 또는 ANDROID 여야 해요");
      if (typeof appVersion !== "string" || appVersion.length < 1 || appVersion.length > 20) return err(400, "VALIDATION_FAILED", "appVersion 은 1~20자여야 해요");
      s.pushDevices = devices.filter((d) => d.token !== token);
      s.pushDevices.push({ token, userId, platform, appVersion, lastSeenAt: nowIso() });
      const mine = s.pushDevices.filter((d) => d.userId === userId).sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
      if (mine.length > 10) {
        const drop = new Set(mine.slice(0, mine.length - 10).map((d) => d.token));
        s.pushDevices = s.pushDevices.filter((d) => !drop.has(d.token));
      }
      return ok({ ok: true });
    }
    if (method === "DELETE") {
      s.pushDevices = devices.filter((d) => !(d.token === token && d.userId === userId));
      return ok({ ok: true });
    }
  }

  // (#188) /me/notification-settings (7-1). 불리언만, 빈 본문은 그대로
  if (seg[0] === "me" && seg[1] === "notification-settings" && seg.length === 2) {
    const u = s.users.find((x) => x.id === userId)!;
    const current = { ...DEFAULT_NOTIFY, ...u.notify };
    if (method === "GET") return ok(current);
    if (method === "PATCH") {
      const next = { ...current };
      for (const [k, v] of Object.entries(body ?? {})) {
        if (!NOTIFY_KEYS.includes(k as keyof NotificationSettings)) return err(400, "VALIDATION_FAILED", `${k} 은(는) 허용되지 않는 항목이에요`);
        if (typeof v !== "boolean") return { status: 400, body: errorBody(400, "VALIDATION_FAILED", `${k} 은(는) 참/거짓이어야 해요`, [{ field: k, message: `${k} 은(는) 참/거짓이어야 해요` }]) };
        next[k as keyof NotificationSettings] = v;
      }
      u.notify = next;
      return ok(next);
    }
  }
  return null;
}
