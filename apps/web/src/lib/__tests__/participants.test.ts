import { describe, expect, it } from "vitest";
import { memberColor } from "../colors";
import {
  barColors,
  chipColor,
  copyPick,
  dotCluster,
  eventColors,
  normalizePick,
  participantColors,
  participantLabel,
  participantsBody,
  participantsChanged,
  participantsFromPick,
  participantsOf,
  pickOf,
  samePick,
  showParticipantRow,
  splitBackground,
} from "../participants";
import { MEMBER_COLORS, type Member } from "../types";

const names = ["지우", "하늘", "민지", "지훈", "수아"];
const m = (i: number): Member => ({ userId: i + 1, displayName: names[i], color: MEMBER_COLORS[i], profileImageUrl: null });
const c = (i: number) => memberColor(MEMBER_COLORS[i]);
const creator = m(0);
const ev = (...who: number[]) => ({ creator, participants: { all: false, members: who.map(m) } });
const all = (...who: number[]) => ({ creator, participants: { all: true, members: who.map(m) } });
const ME = 1;

describe("participantsOf, participantColors (#248 7-1)", () => {
  it("옛 API 는 등록자 한 명으로 본다", () => {
    expect(participantsOf({ creator })).toEqual({ all: false, members: [creator] });
    expect(participantColors({ creator })).toEqual([c(0)]);
  });

  it("응답 값 그대로, 색은 화면 색 (가입순)", () => {
    expect(participantColors(ev(1, 2))).toEqual([c(1), c(2)]);
    expect(participantColors(ev())).toEqual([]);
  });
});

describe("barColors — 막대 색 (기획 3-4)", () => {
  it("0명이면 회색 하나", () => {
    expect(barColors(ev())).toEqual(["var(--mute)"]);
  });
  it("1명", () => {
    expect(barColors(ev(2))).toEqual([c(2)]);
  });
  it("3명까지는 그 색", () => {
    expect(barColors(ev(0, 1, 2))).toEqual([c(0), c(1), c(2)]);
  });
  it("4명 이상이면 앞 3색 + 회색", () => {
    expect(barColors(all(0, 1, 2, 3, 4))).toEqual([c(0), c(1), c(2), "var(--mute)"]);
  });
});

describe("splitBackground — 같은 폭 단단한 경계 (D-141)", () => {
  it("색 하나면 단색", () => {
    expect(splitBackground(["red"], "to right")).toBe("red");
  });
  it("빈 배열이면 회색", () => {
    expect(splitBackground([], "to right")).toBe("var(--mute)");
  });
  it("둘이면 반씩", () => {
    expect(splitBackground(["a", "b"], "to bottom")).toBe("linear-gradient(to bottom, a 0% 50%, b 50% 100%)");
  });
  it("셋이면 1/3 씩", () => {
    expect(splitBackground(["a", "b", "c"], "to right")).toBe("linear-gradient(to right, a 0% 33.33%, b 33.33% 66.67%, c 66.67% 100%)");
  });
});

describe("participantLabel — 이름 표기", () => {
  it("나 하나", () => expect(participantLabel(ev(0), ME)).toBe("나"));
  it("한 명", () => expect(participantLabel(ev(2), ME)).toBe("민지"));
  it("두 명", () => expect(participantLabel(ev(2, 3), ME)).toBe("민지, 지훈"));
  it("두 명 중 나", () => expect(participantLabel(ev(0, 1), ME)).toBe("나, 하늘"));
  it("셋 이상", () => expect(participantLabel(ev(2, 3, 4), ME)).toBe("민지 외 2명"));
  it("모두", () => expect(participantLabel(all(0, 1), ME)).toBe("모두"));
  it("참여자 없음", () => expect(participantLabel(ev(), ME)).toBe("참여자 없음"));
  it("내 id 를 모르면 이름 그대로", () => expect(participantLabel(ev(0), null)).toBe("지우"));
});

describe("dotCluster, chipColor — PC 칩, 다가오는 일정 카드", () => {
  it("참여자 없음은 회색 점 하나, 칩 면도 회색", () => {
    expect(dotCluster(ev())).toEqual({ dots: ["var(--mute)"], more: false });
    expect(chipColor(ev())).toBe("var(--mute)");
  });
  it("3명까지 점, 넘치면 more", () => {
    expect(dotCluster(ev(0, 1))).toEqual({ dots: [c(0), c(1)], more: false });
    expect(dotCluster(all(0, 1, 2, 3))).toEqual({ dots: [c(0), c(1), c(2)], more: true });
  });
  it("칩 면은 첫 참여자 색", () => {
    expect(chipColor(ev(3, 1))).toBe(c(3));
  });
});

describe("일정 색 (#343, D-215)", () => {
  const PINK = MEMBER_COLORS[7];
  it("고른 색이 있으면 막대, 점, 칩 모두 그 색 하나 (참여자 수와 무관)", () => {
    const colored = { ...all(0, 1, 2, 3, 4), color: PINK };
    expect(eventColors(colored)).toEqual(["var(--m8)"]);
    expect(barColors(colored)).toEqual(["var(--m8)"]);
    expect(dotCluster(colored)).toEqual({ dots: ["var(--m8)"], more: false });
    expect(chipColor(colored)).toBe("var(--m8)");
    // 참여자 없음이어도 고른 색
    expect(chipColor({ ...ev(), color: MEMBER_COLORS[0] })).toBe("var(--m1)");
  });
  it("null, 생략(옛 API)이면 자동 = 참여자 색. 이름 표기는 그대로", () => {
    expect(eventColors({ ...ev(1, 2), color: null })).toEqual([c(1), c(2)]);
    expect(eventColors(ev(1, 2))).toEqual([c(1), c(2)]);
    expect(participantLabel({ ...ev(1, 2), color: PINK }, ME)).toBe(participantLabel(ev(1, 2), ME));
  });
});

describe("pickOf, samePick, copyPick — 폼 값과 바뀜 판단 (D-142)", () => {
  it("응답 → 폼 값", () => {
    expect(pickOf(all(0, 1))).toBe("ALL");
    expect(pickOf(ev(1, 2))).toEqual([2, 3]);
    expect(pickOf(ev())).toEqual([]);
  });

  it("같은 선택은 순서 무시", () => {
    expect(samePick([1, 2], [2, 1])).toBe(true);
    expect(samePick("ALL", "ALL")).toBe(true);
    expect(samePick("ALL", [1, 2])).toBe(false);
    expect(samePick([1], [1, 2])).toBe(false);
    expect(samePick([1, 3], [1, 2])).toBe(false);
    expect(samePick([], [])).toBe(true);
  });

  it("복제는 지금 멤버로 거르고 비면 나", () => {
    expect(copyPick(pickOf(all(0, 1)), [1, 2], ME)).toBe("ALL");
    expect(copyPick(pickOf(ev(1, 4)), [1, 2, 3], ME)).toEqual([2]);
    expect(copyPick(pickOf(ev(4)), [1, 2], ME)).toEqual([ME]);
    expect(copyPick(pickOf(ev()), [1, 2], ME)).toEqual([ME]);
    expect(copyPick([2], [1, 2], ME)).toEqual([2]);
  });

  it("고른 값 → 팀 멤버 가입순 참여자", () => {
    const members = [m(0), m(1), m(2)];
    expect(participantsFromPick("ALL", members)).toEqual({ all: true, members });
    expect(participantsFromPick([3, 1, 9], members)).toEqual({ all: false, members: [m(0), m(2)] });
  });

  it("본문용 정렬, 중복 제거", () => {
    expect(normalizePick([3, 1, 3])).toEqual([1, 3]);
    expect(normalizePick("ALL")).toBe("ALL");
  });
});

describe("폼 참여자 줄과 본문 (7-3, D-135, D-142)", () => {
  it("개인 팀, 이 일정만 수정에서는 줄이 없다", () => {
    expect(showParticipantRow({ personal: true, thisOnly: false })).toBe(false);
    expect(showParticipantRow({ personal: false, thisOnly: true })).toBe(false);
    expect(showParticipantRow({ personal: false, thisOnly: false })).toBe(true);
  });

  it("생성: 팀이면 늘 싣고 개인 팀은 생략", () => {
    expect(participantsBody({ editing: false, personal: false, scope: null, current: [3, 1], initial: null })).toEqual([1, 3]);
    expect(participantsBody({ editing: false, personal: false, scope: null, current: "ALL", initial: null })).toBe("ALL");
    expect(participantsBody({ editing: false, personal: true, scope: null, current: [1], initial: null })).toBeUndefined();
  });

  it("수정: 안 바꾸면 본문에 없다 (참여자 없음 일정 포함)", () => {
    expect(participantsBody({ editing: true, personal: false, scope: null, current: [2, 1], initial: [1, 2] })).toBeUndefined();
    expect(participantsBody({ editing: true, personal: false, scope: null, current: [], initial: [] })).toBeUndefined();
    expect(participantsBody({ editing: true, personal: false, scope: "following", current: "ALL", initial: "ALL" })).toBeUndefined();
  });

  it("수정: 바꾸면 싣고, 범위 시트는 이 일정만을 막는다", () => {
    expect(participantsBody({ editing: true, personal: false, scope: "following", current: [2], initial: [1] })).toEqual([2]);
    expect(participantsChanged({ editing: true, current: [2], initial: [1] })).toBe(true);
    expect(participantsChanged({ editing: true, current: [1], initial: [1] })).toBe(false);
    expect(participantsChanged({ editing: false, current: [2], initial: null })).toBe(false);
  });

  it("이 일정만 범위에는 바꿨어도 싣지 않는다", () => {
    expect(participantsBody({ editing: true, personal: false, scope: "this", current: [2], initial: [1] })).toBeUndefined();
  });
});
