"use client";
// (#450) AI 비서 대화 몸통 (설계 AI-비서.md 7-2, 7-5, 7-8, 7-9, 승인 시안). 폰 전체 화면(AssistantScreen)과 넓은 화면 오른쪽 패널이 같이 쓴다.
//   처음 쓸 때 안내 카드(동의 전) → 빈 상태(인사 + 예시 3개) → 대화(내 말 오른쪽 코랄, 볼까 왼쪽 타일 + 카드)
//   아래 입력 줄: 여러 줄 입력(최대 4줄) + 원형 보내기. 하루 한도면 입력 대신 안내, 동의 뒤에는 늘 "오늘 N번 남았어요" (5번 이하는 강조, #470)
// 읽기: 대화 목록은 role=log(카드까지 읽지 않게 aria-live 끔), 볼까 답 글자만 따로 aria-live 로 읽는다. 보낸 뒤 포커스는 입력에 남는다
import Link from "next/link";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useGroupContext } from "./AppShell";
import { useAssistant } from "./AssistantProvider";
import { AssistantCardView, type CardTone } from "./AssistantCards";
import { IconArrowRight, IconChevronRight, IconSparkle } from "./icons";
import { Button, InlineError } from "./ui";
import { COUNTER_FROM, examplePrompts, REMAIN_HINT, TEXT_MAX, type ChatMessage, type ShowDate } from "@/lib/assistant";
import { newEventHref } from "@/lib/routes";
import { useLayout } from "@/lib/useLayout";

export type AssistantChatHandle = { focusInput: () => void };

type Props = {
  /** screen: 폰 전체 화면(문서가 스크롤, 입력 줄은 바닥에 붙는다). panel: 넓은 화면 오른쪽 패널(안쪽만 스크롤) */
  variant: "screen" | "panel";
  /** 넓은 화면 패널: [추가] 뒤 달력이 그날을 보이게 */
  onShowDate?: ShowDate;
};

export const AssistantChat = forwardRef<AssistantChatHandle, Props>(function AssistantChat({ variant, onShowDate }, ref) {
  const a = useAssistant();
  const { group } = useGroupContext();
  const wide = useLayout() !== "phone";
  const tone: CardTone = variant === "panel" ? "surface" : "paper";
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focusInput: () => input.current?.focus() }), []);

  const personal = group?.type === "PERSONAL";
  const memberCount = group?.members.length ?? 1;
  const examples = examplePrompts({ personal, memberCount });
  const blocked = a.consented !== true || a.limited;
  const canSend = text.trim().length > 0 && !a.pending && !blocked;

  // 새 말풍선, 점 세 개가 생기면 맨 아래로
  const count = a.messages.length;
  useEffect(() => {
    if (count === 0 && !a.pending) return;
    if (variant === "panel") {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else {
      end.current?.scrollIntoView({ block: "end" });
    }
  }, [count, a.pending, variant]);

  // 입력 칸은 내용만큼 늘어난다 (최대 4줄, 그 뒤는 안에서 스크롤)
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [text]);

  async function submit(raw: string) {
    if (!raw.trim() || a.pending || blocked) return;
    const before = raw;
    setText("");
    const r = await a.send(raw);
    // 400(글자 수 등)이면 보낸 말풍선을 만들지 않고 글을 입력에 돌려 둔다 (7-8)
    if (r === "invalid") setText(before);
    input.current?.focus();
  }

  const lastReply = [...a.messages].reverse().find((m) => m.role === "assistant" || m.role === "error");
  const live = lastReply ? (lastReply.role === "assistant" ? lastReply.reply : lastReply.text) : "";

  const body =
    a.consented === false ? (
      <ConsentCard tone={tone} />
    ) : a.messages.length === 0 && !a.pending ? (
      <section aria-labelledby="assistant-hello" className="pt-4">
        <h2 id="assistant-hello" className="text-[22px] font-bold leading-[30px] tracking-[-0.02em]">
          AI 비서 볼까예요.
          <br />
          무엇을 도와 드릴까요?
        </h2>
        <p className="mt-2 text-[14px] leading-[21px] text-ink-2">
          일정을 만들고 고치고, 다 같이 되는 시간을 찾고, 투표도 열어 드려요. 말로 해도 돼요. 일정 말고 다른 질문에는 답하지 않아요
        </p>
        <ul aria-label="이렇게 물어보세요" className="mt-5 space-y-2">
          {examples.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                disabled={blocked || a.consented === null}
                onClick={() => void submit(ex)}
                className={`flex min-h-12 w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left text-[15px] font-medium leading-5 text-ink hover:brightness-95 disabled:text-ink-2 ${tone === "paper" ? "bg-paper" : "bg-surface"}`}
              >
                <span className="min-w-0 flex-1">{ex}</span>
                <IconArrowRight size={16} className="shrink-0 text-ink-2" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : (
      <ol role="log" aria-live="off" aria-label="볼까와 나눈 대화" aria-busy={a.pending || undefined} className="flex flex-col gap-3 pt-3">
        {a.messages.map((m) => (
          <MessageView key={m.id} m={m} tone={tone} onShowDate={onShowDate} />
        ))}
        {a.pending && (
          <li className="flex">
            <span
              role="status"
              aria-label="볼까가 답을 쓰는 중"
              className={`flex h-10 items-center gap-1 rounded-[18px_18px_18px_4px] px-4 ${tone === "paper" ? "bg-paper" : "bg-surface"}`}
            >
              {[0, 1, 2].map((i) => (
                <span key={i} aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-ink-2" style={{ animationDelay: `${i * 160}ms` }} />
              ))}
            </span>
          </li>
        )}
      </ol>
    );

  const footer = (
    <div
      className={
        variant === "screen"
          ? "sticky bottom-0 -mx-5 mt-4 bg-surface px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2 fold:mx-0 fold:px-0"
          : "shrink-0 border-t border-line px-4 py-3"
      }
    >
      {a.consented === true && !a.limited && a.remaining !== null && (
        // (#470) 늘 보인다. 5번 이하는 강조색
        <p className={`mb-1.5 text-[12px] leading-4 ${a.remaining <= REMAIN_HINT ? "font-semibold text-ink" : "text-ink-2"}`}>
          오늘 {a.remaining}번 남았어요 (하루 {a.limit}번)
        </p>
      )}
      {a.limited ? (
        <div role="status" className={`rounded-xl px-4 py-3 ${tone === "paper" ? "bg-paper" : "bg-surface"}`}>
          <p className="text-[14px] font-semibold leading-5">오늘은 {a.limit}번 다 썼어요. 내일 다시 만나요</p>
          <Link href={newEventHref()} className="mt-1 inline-flex min-h-11 items-center gap-0.5 text-[14px] font-bold text-btn">
            직접 일정 추가
            <IconChevronRight size={14} />
          </Link>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(text);
          }}
          className="flex items-end gap-2"
        >
          <label htmlFor="assistant-input" className="sr-only">
            볼까에게 보낼 글
          </label>
          <textarea
            id="assistant-input"
            ref={input}
            rows={1}
            value={text}
            maxLength={TEXT_MAX}
            disabled={blocked}
            enterKeyHint="send"
            placeholder={wide ? "볼까에게 적어 주세요" : "말하거나 적어 주세요 (키보드 마이크)"}
            aria-describedby={a.inputError ? "assistant-input-err" : undefined}
            aria-invalid={a.inputError ? true : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 넓은 화면은 Enter 보내기, Shift+Enter 줄바꿈. 한글 조합 중 Enter 는 조합 끝내기라 보내지 않는다. 폰은 보내기 버튼만
              if (!wide || e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              void submit(text);
            }}
            className={`min-h-11 min-w-0 flex-1 resize-none rounded-[22px] px-4 py-[11px] text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-2 focus-visible:ring-2 focus-visible:ring-[var(--pri)] disabled:opacity-60 ${
              tone === "paper" ? "bg-paper" : "bg-surface"
            }`}
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="보내기"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-btn text-on-btn disabled:bg-line disabled:text-ink-2"
          >
            <IconArrowRight size={20} strokeWidth={2.2} className="-rotate-90" />
          </button>
        </form>
      )}
      {!a.limited && text.length >= COUNTER_FROM && (
        <p className="mt-1 text-right text-[12px] leading-4 text-ink-2 tabular-nums">
          {text.length}/{TEXT_MAX}
        </p>
      )}
      {a.inputError && (
        <InlineError id="assistant-input-err" className="mt-1">
          {a.inputError}
        </InlineError>
      )}
    </div>
  );

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {live}
      </p>
      {variant === "screen" ? (
        // 입력 줄이 화면 바닥에 오게 남은 높이를 채운다: 폰 머리줄 52 + 볼까 머리줄 48 + 본문 아래 여백 24 (넓은 화면은 위아래 28 + 머리줄 48)
        <div className="flex min-h-[calc(100dvh-124px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col fold:min-h-[calc(100dvh-104px)]">
          <div className="flex-1 pb-2">{body}</div>
          <div ref={end} />
          {footer}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {body}
          </div>
          {footer}
        </div>
      )}
    </>
  );
});

function MessageView({ m, tone, onShowDate }: { m: ChatMessage; tone: CardTone; onShowDate?: ShowDate }) {
  const { retry, pending } = useAssistant();
  const bubble = tone === "paper" ? "bg-paper" : "bg-surface";
  if (m.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-[82%] whitespace-pre-wrap rounded-[18px_18px_4px_18px] bg-btn px-4 py-2.5 text-[15px] leading-[22px] text-on-btn [overflow-wrap:anywhere]">
          <span className="sr-only">나: </span>
          {m.text}
        </p>
      </li>
    );
  }
  if (m.role === "error") {
    return (
      <li className="flex flex-col items-start gap-1">
        <p role="alert" className={`max-w-[82%] rounded-[18px_18px_18px_4px] px-4 py-2.5 text-[15px] font-medium leading-[22px] text-acc-ink ${bubble}`}>
          <span className="sr-only">볼까: </span>
          {m.text}
        </p>
        {m.retry && (
          <button type="button" disabled={pending} onClick={() => retry(m.id)} className="hit h-8 px-1 text-[13px] font-bold text-btn disabled:text-ink-2">
            다시 보내기
          </button>
        )}
      </li>
    );
  }
  const cards = m.role === "assistant" ? m.cards : [m.card];
  return (
    <li className="flex flex-col items-start gap-2">
      {m.role === "assistant" && (
        <p className={`max-w-[82%] whitespace-pre-wrap rounded-[18px_18px_18px_4px] px-4 py-2.5 text-[15px] leading-[22px] text-ink ${bubble}`}>
          <span className="sr-only">볼까: </span>
          {m.reply}
        </p>
      )}
      {cards.map((card, i) => (
        <div key={i} className={card.type === "clarify" || card.type === "unsupported" ? "" : "w-full"}>
          <AssistantCardView card={card} resultKey={`${m.id}:${i}`} tone={tone} onShowDate={onShowDate} />
        </div>
      ))}
    </li>
  );
}

/** 처음 쓸 때 안내 (7-5, D-270). 동의 전에는 입력을 막는다 */
function ConsentCard({ tone }: { tone: CardTone }) {
  const a = useAssistant();
  return (
    <section aria-labelledby="assistant-consent" className={`mt-4 rounded-xl p-4 ${tone === "paper" ? "bg-paper" : "bg-surface"}`}>
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-hover text-pri">
        <IconSparkle size={20} />
      </span>
      <h2 id="assistant-consent" className="mt-3 text-[15px] font-bold leading-5">
        볼까를 쓰기 전에
      </h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[13px] leading-[19px] text-ink marker:text-ink-2">
        <li>내가 쓴 글과 팀 멤버 이름을 OpenAI(미국)로 보내 뜻을 알아내요. 일정을 물을 때는 그 기간 일정의 제목과 시각도 보내요</li>
        <li>대화는 언제볼까에 저장하지 않아요. 화면을 닫으면 사라져요</li>
        <li>볼까는 저장하지 않고 카드로 보여 줘요. [추가], [수정], [삭제] 를 눌러야 반영돼요</li>
        <li>하루 {a.limit}번까지 쓸 수 있어요</li>
      </ul>
      <Link href="/privacy#assistant" className="mt-3 inline-flex min-h-11 items-center text-[13px] font-semibold text-ink-2 underline underline-offset-2">
        개인정보처리방침
      </Link>
      {a.consentError && <InlineError className="mb-2">{a.consentError}</InlineError>}
      <Button size="xl" full loading={a.consentPending} onClick={() => void a.consent()}>
        동의하고 시작
      </Button>
    </section>
  );
}
