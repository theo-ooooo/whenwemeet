"use client";
// (#450) AI 비서 "볼까" 대화 상태 (설계 AI-비서.md 7-4, D-264, D-272). AppShell 안에 둔다.
// - 대화는 메모리에만. 지우는 때: 머리줄 ‹ 또는 패널 ✕(clear), 팀 전환(groupId 가 바뀌면), 새로고침(메모리라 저절로)
// - 카드 링크([고치기], 상세, 달력에서 보기)로 나갔다 돌아오면 그대로 (AppShell 은 팀 화면 사이에서 그대로 남는다)
// - 버튼 노출(available), 동의(consented), 남은 횟수는 GET /me 의 assistant 와 응답 usage 로 맞춘다
// - 넓은 화면 오른쪽 패널의 열림(panelOpen)도 여기. 주소에 넣지 않는다 (일 상세의 URL 단계와 섞지 않음, 7-3)
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAssistantConsent, useMe, useSendAssistantMessage } from "@/hooks";
import { buildHistory, dailyLimited, nextKstMidnight, type AssistantCard, type ChatMessage } from "@/lib/assistant";

export type SendResult = "sent" | "invalid" | "skipped";

/**
 * 카드에서 한 번 한 일 (같은 카드의 [추가], [투표 열기], "투표 열기 초안", (#511) [수정], [삭제], 후보 고르기는 한 번만, 7-6).
 * 카드 컴포넌트가 다시 그려져도(패널을 닫았다 열기, 폼에 갔다 돌아오기) 남게 대화와 같이 둔다. 키 = `${메시지 id}:${카드 순번}`
 */
export type CardResult =
  | { kind: "event"; title: string; date: string; publicCode: string }
  | { kind: "poll"; href: string }
  | { kind: "drafted" }
  // (#511) 고치기 [수정] 뒤, 지우기 [삭제] 뒤, 지우기 [취소] 뒤, 고르기에서 하나 고른 뒤
  | { kind: "edited"; title: string; date: string; publicCode: string; occurrence: string | null }
  | { kind: "deleted"; title: string }
  | { kind: "kept" }
  | { kind: "picked"; index: number };

type AssistantCtx = {
  /** /me 를 받았는지 (실패도 받은 것으로 본다) */
  ready: boolean;
  /** 서버에 키가 있어 볼까를 쓸 수 있는지. false 면 버튼을 그리지 않는다 (D-271) */
  available: boolean;
  /** /me 를 아직 못 받았으면 null */
  consented: boolean | null;
  messages: ChatMessage[];
  pending: boolean;
  /** 400 검사 실패 문구. 입력 아래 한 줄 */
  inputError: string | null;
  /** 하루 한도에 걸렸는지 (KST 자정 지나면 풀린다) */
  limited: boolean;
  /** 오늘 남은 횟수. 모르면 null */
  remaining: number | null;
  /** 하루 한도 (안내 문구용) */
  limit: number;
  send: (text: string) => Promise<SendResult>;
  /** 오류 말풍선의 "다시 보내기": 그 말풍선을 지우고 같은 글을 다시 보낸다 (내 말풍선은 그대로) */
  retry: (errorId: number) => void;
  /** 웹이 만든 카드(빈 시간 → 투표 초안)를 대화에 더한다. 서버 요청 없음 */
  addLocal: (card: AssistantCard) => void;
  /** 대화를 지우고 보내는 중인 요청을 끊는다 (서버 횟수는 이미 셌고 되돌리지 않는다) */
  clear: () => void;
  consent: () => Promise<boolean>;
  consentPending: boolean;
  consentError: string | null;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  results: Record<string, CardResult>;
  setResult: (key: string, result: CardResult) => void;
};

const Ctx = createContext<AssistantCtx | null>(null);

export function useAssistant(): AssistantCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AssistantProvider 안에서만 쓸 수 있어요");
  return ctx;
}

/** 오류 말풍선 기본 문구 (서버 문구가 없을 때) */
const UNSTABLE = "연결이 불안정해요. 다시 보내 주세요";
const RATE = "잠시 후 다시 보내 주세요";

export function AssistantProvider({ groupId, children }: { groupId: number | null; children: React.ReactNode }) {
  const meQ = useMe();
  const meta = meQ.data?.assistant ?? null;
  const ready = meQ.data !== null || meQ.error !== null;
  const refetchMe = meQ.refetch;
  const sendM = useSendAssistantMessage(groupId ?? 0);
  const consentM = useAssistantConsent();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  // 서버 값(meta)과 다르게 알게 된 동의 상태: 동의 성공 true, 409 false
  const [consentOverride, setConsentOverride] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [results, setResults] = useState<Record<string, CardResult>>({});
  const setResult = useCallback((key: string, result: CardResult) => setResults((r) => ({ ...r, [key]: result })), []);

  const messagesRef = useRef<ChatMessage[]>([]);
  const seq = useRef(0);
  // 지우기(닫기, 팀 전환)마다 올린다. 그 전에 보낸 요청의 응답은 버린다
  const gen = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  const commit = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const clear = useCallback(() => {
    gen.current += 1;
    ctrl.current?.abort();
    ctrl.current = null;
    commit([]);
    setResults({});
    setPending(false);
    setInputError(null);
  }, [commit]);

  // 팀을 바꾸면 대화를 지우고 열린 패널도 닫는다 (보내던 요청도 끊는다)
  const shownGroup = useRef(groupId);
  useEffect(() => {
    if (shownGroup.current === groupId) return;
    shownGroup.current = groupId;
    // 효과 본문에서 바로 setState 하지 않도록 마이크로태스크로 미룬다 (hooks/_useQuery 와 같은 규칙)
    queueMicrotask(() => {
      clear();
      setPanelOpen(false);
    });
  }, [groupId, clear]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const limit = usage?.limit ?? meta?.dailyLimit ?? 30;
  const used = usage?.used ?? meta?.usedToday ?? null;
  const limited = dailyLimited({ used: used ?? 0, limit, resetAt });
  const remaining = used === null ? null : Math.max(0, limit - used);
  const consented = consentOverride ?? (meta ? meta.consented : null);
  const sendMutate = sendM.mutate;

  const request = useCallback(
    async (text: string, addUser: boolean): Promise<SendResult> => {
      if (groupId === null) return "skipped";
      const history = buildHistory(messagesRef.current);
      const userId = ++seq.current;
      if (addUser) commit([...messagesRef.current, { id: userId, role: "user", text }]);
      const myGen = gen.current;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setPending(true);
      setInputError(null);
      const r = await sendMutate({ text, history: history.length ? history : undefined, signal: c.signal });
      if (myGen !== gen.current || c.signal.aborted) return "skipped";
      ctrl.current = null;
      setPending(false);
      const dropUser = () => commit(messagesRef.current.filter((m) => m.id !== userId));
      if (r.ok) {
        const d = r.data;
        commit([...messagesRef.current, { id: ++seq.current, role: "assistant", reply: d.reply, cards: d.cards ?? [], historyText: d.historyText ?? "" }]);
        if (d.usage) setUsage(d.usage);
        return "sent";
      }
      const e = r.error;
      if (e.status === 400) {
        if (addUser) dropUser();
        setInputError(e.message || "보낼 수 없는 글이에요");
        return "invalid";
      }
      if (e.status === 409 && e.code === "ASSISTANT_CONSENT_REQUIRED") {
        if (addUser) dropUser();
        setConsentOverride(false);
        return "invalid";
      }
      if (e.status === 429 && e.code === "ASSISTANT_DAILY_LIMIT") {
        setResetAt(nextKstMidnight());
        setUsage((u) => ({ used: u?.limit ?? limit, limit: u?.limit ?? limit }));
        return "sent";
      }
      if (e.status === 403) {
        // 팀 멤버가 아니게 됐다. AppShell 이 안내 화면으로 바꾼다 (lib/api GROUP_GONE_EVENT)
        return "skipped";
      }
      const message = e.status === 429 ? RATE : e.status === 0 ? UNSTABLE : e.message || UNSTABLE;
      commit([...messagesRef.current, { id: ++seq.current, role: "error", text: message, retry: text }]);
      return "sent";
    },
    [groupId, commit, sendMutate, limit],
  );

  const send = useCallback(
    async (raw: string): Promise<SendResult> => {
      const text = raw.trim();
      if (!text || pending || limited) return "skipped";
      return request(text, true);
    },
    [pending, limited, request],
  );

  const retry = useCallback(
    (errorId: number) => {
      const target = messagesRef.current.find((m) => m.id === errorId);
      if (!target || target.role !== "error" || !target.retry || pending || limited) return;
      commit(messagesRef.current.filter((m) => m.id !== errorId));
      void request(target.retry, false);
    },
    [commit, pending, limited, request],
  );

  const addLocal = useCallback(
    (card: AssistantCard) => commit([...messagesRef.current, { id: ++seq.current, role: "local", card }]),
    [commit],
  );

  const consentMutate = consentM.mutate;
  const [consentError, setConsentError] = useState<string | null>(null);
  const consent = useCallback(async () => {
    setConsentError(null);
    const r = await consentMutate(undefined);
    if (!r.ok) {
      setConsentError(r.error.message || "동의하지 못했어요. 다시 시도해 주세요");
      return false;
    }
    setConsentOverride(true);
    void refetchMe();
    return true;
  }, [consentMutate, refetchMe]);

  const value = useMemo<AssistantCtx>(
    () => ({
      ready,
      available: meta?.available === true,
      consented,
      messages,
      pending,
      inputError,
      limited,
      remaining,
      limit,
      send,
      retry,
      addLocal,
      clear,
      consent,
      consentPending: consentM.isPending,
      consentError,
      panelOpen,
      setPanelOpen,
      results,
      setResult,
    }),
    [ready, meta, consented, messages, pending, inputError, limited, remaining, limit, send, retry, addLocal, clear, consent, consentM.isPending, consentError, panelOpen, results, setResult],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
