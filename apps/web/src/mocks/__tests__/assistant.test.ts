// (#450) 목 AI 비서: /me 의 assistant, 동의(멱등), 키워드별 카드와 문구, 오류 코드, 하루 횟수(되돌림 포함)
import { beforeEach, describe, expect, it } from "vitest";
import { mockHandle } from "../handler";
import { ME_ID, PERSONAL_ID, TEAM_ID } from "../fixtures";

type Res = { status: number; body: { data: Record<string, unknown> | null; error?: { code: string; details?: { field: string }[] } } };
const call = (method: string, path: string, body: Record<string, unknown> | null = null) =>
  mockHandle({ method, path, query: new URLSearchParams(), body, userId: ME_ID }) as Res;
const say = (text: string, groupId = TEAM_ID) => call("POST", `/groups/${groupId}/assistant/messages`, { text });
const cardsOf = (r: Res) => (r.body.data as { cards: { type: string }[] }).cards;
const meta = () => (call("GET", "/me").body.data as { assistant: { available: boolean; consented: boolean; usedToday: number; dailyLimit: number } }).assistant;

beforeEach(() => {
  // 저장소를 처음으로 (탈퇴 목은 상태를 초기화한다)
  call("DELETE", "/me");
});

describe("목 AI 비서 (#450)", () => {
  it("동의 전에는 409, 동의는 멱등이고 /me 에 반영된다", () => {
    expect(meta()).toEqual({ available: true, consented: false, dailyLimit: 30, usedToday: 0 });
    const blocked = say("이번 주에 뭐 있어?");
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.code).toBe("ASSISTANT_CONSENT_REQUIRED");
    const first = call("POST", "/me/assistant-consent").body.data?.consentedAt;
    expect(call("POST", "/me/assistant-consent").body.data?.consentedAt).toBe(first);
    expect(meta().consented).toBe(true);
    expect(meta().usedToday).toBe(0);
  });

  describe("동의 뒤", () => {
    beforeEach(() => {
      call("POST", "/me/assistant-consent");
    });

    it("빈 글, 300자 초과는 400(field text) 이고 세지 않는다", () => {
      expect(say("   ").status).toBe(400);
      const long = say("가".repeat(301));
      expect(long.status).toBe(400);
      expect(long.body.error?.details?.[0].field).toBe("text");
      expect(meta().usedToday).toBe(0);
    });

    it("일정 초안: 문구 틀 + eventDraft 카드, 횟수 1", () => {
      const r = say("다음 주 금요일 7시 강남 회식 하늘이랑 잡아줘");
      expect(r.status).toBe(200);
      const d = r.body.data as { reply: string; cards: { type: string; draft: { title: string; place: { text: string }; members: { displayName: string }[] } }[]; usage: { used: number } };
      expect(d.reply).toBe("이렇게 넣을까요?");
      expect(d.cards[0].type).toBe("eventDraft");
      expect(d.cards[0].draft.title).toBe("강남 회식");
      expect(d.cards[0].draft.place).toEqual({ text: "강남" });
      expect(d.cards[0].draft.members.map((m) => m.displayName)).toContain("하늘");
      expect(d.usage.used).toBe(1);
      expect(meta().usedToday).toBe(1);
    });

    it("빈 시간 + 투표: freeSlots 와 pollDraft", () => {
      const types = cardsOf(say("이번 달 주말에 둘 다 되는 저녁 찾아서 투표 열어줘")).map((c) => c.type);
      expect(types[0]).toBe("freeSlots");
      if (types.length > 1) expect(types[1]).toBe("pollDraft");
    });

    it("일정 목록, 기념일, 못 하는 일, 되묻기, 인사, 거절", () => {
      expect(cardsOf(say("이번 주에 뭐 있어?"))[0].type).toBe("eventList");
      expect(cardsOf(say("하늘 생일 언제야?"))[0].type).toBe("eventList");
      expect(cardsOf(say("회식 일정 지워 줘"))[0]).toMatchObject({ type: "unsupported", action: "delete_event" });
      expect(cardsOf(say("금요일에 회의"))[0]).toMatchObject({ type: "clarify", field: "time" });
      expect(cardsOf(say("고마워"))).toEqual([]);
      const refused = say("내일 서울 날씨 어때?");
      expect((refused.body.data as { reply: string }).reply).toBe("볼까는 일정 만들기, 빈 시간 찾기, 투표, 일정 묻기만 도와 드려요");
      expect(cardsOf(refused)).toEqual([{ type: "refusal" }]);
    });

    it("504, 503 은 횟수를 되돌리고 '한도' 는 429 ASSISTANT_DAILY_LIMIT", () => {
      expect(say("답이 느려").status).toBe(504);
      expect(say("장애 테스트").status).toBe(503);
      expect(meta().usedToday).toBe(0);
      const limit = say("한도");
      expect(limit.status).toBe(429);
      expect(limit.body.error?.code).toBe("ASSISTANT_DAILY_LIMIT");
    });

    it("하루 30번을 넘으면 429", () => {
      for (let i = 0; i < 30; i++) expect(say("고마워").status).toBe(200);
      expect(say("고마워").status).toBe(429);
      expect(meta().usedToday).toBe(30);
    });

    it("개인 팀에서도 쓸 수 있다", () => {
      expect(say("내일 7시 약속 잡아줘", PERSONAL_ID).status).toBe(200);
    });
  });
});
