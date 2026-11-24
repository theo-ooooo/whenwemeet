"use client";
// (#198) 내 정보 > 로그인 방법 (D-257).
//   "연결된 방법" 줄마다 이름 + 표시(가린 이메일 등) + [해제](확인 창, 마지막 하나는 숨김)
//   "다른 방법 연결" 줄: 카카오, Apple 은 form POST /me/link/start → 제공자 화면 → /me/link 가 연결하고 결과를 주소에 싣고 돌아온다.
//   이메일은 시트에서 주소 → 코드 메일 → 6자리 코드. 결과는 토스트
//   앱 셸 안에서 카카오, Apple 버튼은 셸이 AccountLink/1 을 알 때만. 앱에서는 form POST 대신 셸 브리지 linkAccount 로
//   네이티브 로그인 결과를 받아 세션으로 POST /me/auth-accounts (앱.md 4.8, D-282). 이메일 연결은 앱에서도 같은 시트
//   보안을 위해 최근 로그인(10분)이 아니면 다시 로그인을 권한다(REAUTH_REQUIRED). 다시 로그인하면 이 화면으로 돌아온다
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CodeInput } from "@/components/CodeInput";
import { IconPlus } from "@/components/icons";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useToast } from "@/components/Toast";
import { Button, ConfirmDialog, ErrorState, InlineError, RowGroup, rowClass, Sheet, Skeleton, inputClass } from "@/components/ui";
import {
  messageOf,
  useAuthAccounts,
  useCheckAppLink,
  useLinkAppAccount,
  useLinkEmail,
  useRequestLinkEmail,
  useUnlinkAccount,
  type ApiFailure,
} from "@/hooks";
import {
  ACCOUNTS_PATH,
  appLinkFailureMessage,
  type AppLinkCredentials,
  type AppLinkProvider,
  LINK_START_PATH,
  linkableProviders,
  linkedMessage,
  linkErrorMessage,
  PROVIDER_NAME,
  readLinkResult,
  requestAppLink,
  unlinkConfirmBody,
  type LinkProvider,
} from "@/lib/account-link";
import { postToApp } from "@/lib/app-bridge";
import { codeErrorMessage, EMAIL_MAX_LENGTH, isEmailShape, normalizeEmail, OTP_LENGTH, readEmailErrorDetails, requestErrorMessage } from "@/lib/email-login";
import type { AuthAccount } from "@/lib/types";

type Props = {
  inApp: boolean;
  appLink: boolean;
  appleEnabled: boolean;
  emailEnabled: boolean;
};

/** 다시 로그인: 세션 쿠키를 지우고 로그인 화면으로, 로그인하면 이 화면으로 돌아온다 */
function reauth() {
  postToApp({ type: "logout" });
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/auth/logout";
  const next = document.createElement("input");
  next.type = "hidden";
  next.name = "next";
  next.value = ACCOUNTS_PATH;
  form.appendChild(next);
  document.body.appendChild(form);
  form.submit();
}

function AccountRow({ account, canUnlink, onUnlink }: { account: AuthAccount; canUnlink: boolean; onUnlink: () => void }) {
  const name = PROVIDER_NAME[account.provider] ?? account.provider;
  return (
    <div className={rowClass}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{name}</span>
        <span className="t-sub block truncate">{account.label}</span>
      </span>
      {canUnlink && (
        <Button size="sm" variant="secondary" onClick={onUnlink} aria-label={`${name} 해제`}>
          해제
        </Button>
      )}
    </div>
  );
}

/** 카카오, Apple 연결 줄: 누르면 form POST 로 시작 route handler 에 간다 (세션 쿠키, 같은 출처 확인) */
function OAuthLinkRow({ provider }: { provider: "KAKAO" | "APPLE" }) {
  const [going, setGoing] = useState(false);
  const name = PROVIDER_NAME[provider];
  return (
    <form method="POST" action={LINK_START_PATH} onSubmit={() => setGoing(true)} className="block">
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="next" value={ACCOUNTS_PATH} />
      <button type="submit" className={`${rowClass} disabled:opacity-45`} disabled={going}>
        <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center text-ink-2">
          <IconPlus size={16} strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{going ? `${name}로 이동 중…` : `${name} 연결`}</span>
      </button>
    </form>
  );
}

/**
 * (#198) 앱 셸 안의 카카오, Apple 연결 줄 (앱.md 4.8, D-282).
 * 최근 로그인 확인(link-start) → 셸 브리지 linkAccount 로 네이티브 로그인 → 세션으로 POST /me/auth-accounts.
 * 사용자가 시트를 닫으면(cancelled) 아무것도 띄우지 않는다
 */
function AppLinkRow({
  provider,
  onLinked,
  onFailed,
  onReauth,
}: {
  provider: AppLinkProvider;
  onLinked: (absorbed: boolean) => void;
  onFailed: (message: string, refresh: boolean) => void;
  onReauth: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const check = useCheckAppLink();
  const link = useLinkAppAccount();
  const name = PROVIDER_NAME[provider];

  function fail(e: ApiFailure): void {
    if (e.code === "REAUTH_REQUIRED") return onReauth();
    onFailed(linkErrorMessage(e.code, provider) || messageOf(e, "연결하지 못했어요"), e.code === "PROVIDER_ALREADY_LINKED");
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      // 네이티브 로그인 시트를 띄우기 전에 다시 로그인이 필요한지부터 (시트를 두 번 거치지 않게)
      const pre = await check.mutate(provider);
      if (!pre.ok) return fail(pre.error);
      const native = await requestAppLink(provider);
      if (!native.ok) {
        const message = appLinkFailureMessage(native.reason, provider);
        if (message) onFailed(message, false);
        return;
      }
      const cred: AppLinkCredentials =
        native.provider === "KAKAO" ? { provider: "KAKAO", credentials: native.credentials } : { provider: "APPLE", credentials: native.credentials };
      const r = await link.mutate(cred);
      if (r.ok) return onLinked(r.data.absorbed);
      fail(r.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={`${rowClass} disabled:opacity-45`} disabled={busy} onClick={() => void start()}>
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center text-ink-2">
        <IconPlus size={16} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{busy ? `${name}로 연결 중…` : `${name} 연결`}</span>
    </button>
  );
}

/** 이메일 연결 시트: 주소 → 코드 메일 → 6자리 코드. 열 때마다 새로 그려 앞 입력을 남기지 않는다 */
function EmailLinkSheet({
  open,
  onClose,
  onLinked,
  onReauth,
}: {
  open: boolean;
  onClose: () => void;
  onLinked: (absorbed: boolean) => void;
  onReauth: () => void;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useRequestLinkEmail();
  const link = useLinkEmail();
  const codeRef = useRef<HTMLInputElement>(null);

  function fail(e: ApiFailure, kind: "request" | "code"): void {
    if (e.code === "REAUTH_REQUIRED") return onReauth();
    if (kind === "request") setError(requestErrorMessage(e.code, readEmailErrorDetails(e.details)));
    else if (e.code.startsWith("EMAIL_")) setError(codeErrorMessage(e.code, readEmailErrorDetails(e.details)));
    else setError(linkErrorMessage(e.code, "EMAIL") || messageOf(e, "연결하지 못했어요"));
  }

  async function send(ev?: React.FormEvent) {
    ev?.preventDefault();
    const target = normalizeEmail(email);
    if (!isEmailShape(target)) return setError("이메일 주소를 다시 확인해 주세요");
    setError(null);
    const r = await request.mutate(target);
    if (!r.ok) return fail(r.error, "request");
    setSent(target);
    setCode("");
    requestAnimationFrame(() => codeRef.current?.focus());
  }

  async function submit(c: string) {
    if (!sent || link.isPending) return;
    const r = await link.mutate({ email: sent, code: c });
    if (r.ok) return onLinked(r.data.absorbed);
    setCode("");
    fail(r.error, "code");
  }

  return (
    <Sheet open={open} onClose={onClose} title="이메일 연결">
      {!sent ? (
        <form onSubmit={send} noValidate>
          <label htmlFor={`${id}-email`} className="text-[13px] font-semibold">
            이메일 주소
          </label>
          <input
            id={`${id}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={EMAIL_MAX_LENGTH}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={`${id}-msg`}
            className={`${inputClass} mt-2 bg-surface`}
            autoFocus
          />
          {error ? (
            <InlineError id={`${id}-msg`} className="mt-2">
              {error}
            </InlineError>
          ) : (
            <p id={`${id}-msg`} className="t-sub mt-2">
              이 주소로 코드를 보내요
            </p>
          )}
          <div className="pt-5">
            <Button type="submit" size="lg" full loading={request.isPending} disabled={!email.trim()}>
              코드 받기
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <p className="mb-3 text-[14px] leading-5 text-soft">
            <b className="font-semibold text-ink">{sent}</b> 로 보낸 6자리 코드를 입력해 주세요
          </p>
          <CodeInput
            id={`${id}-code`}
            kind="otp"
            inputRef={codeRef}
            value={code}
            onChange={(c) => {
              setCode(c);
              if (error && c.length > 0) setError(null);
              if (c.length === OTP_LENGTH) void submit(c);
            }}
            describedBy={`${id}-code-msg`}
            invalid={Boolean(error)}
            disabled={link.isPending}
            autoFocus
            ariaLabel="연결 코드 6자리"
          />
          {error ? (
            <InlineError id={`${id}-code-msg`} className="mt-2">
              {error}
            </InlineError>
          ) : (
            <p id={`${id}-code-msg`} className="t-sub mt-2">
              15분 안에 입력해 주세요
            </p>
          )}
          <div className="flex gap-2 pt-5">
            <Button variant="secondary" full onClick={() => (setSent(null), setError(null))} disabled={link.isPending}>
              주소 바꾸기
            </Button>
            <Button full onClick={() => void send()} loading={request.isPending} disabled={link.isPending}>
              다시 보내기
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function SignInMethodsScreen({ inApp, appLink, appleEnabled, emailEnabled }: Props) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const accountsQ = useAuthAccounts();
  const accounts = accountsQ.data;
  const unlink = useUnlinkAccount();
  const [target, setTarget] = useState<AuthAccount | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  // 연결 시작이 REAUTH_REQUIRED 로 돌아왔으면 처음부터 다시 로그인 창
  const [reauthOpen, setReauthOpen] = useState(() => params.get("link_error") === "REAUTH_REQUIRED");
  const refetch = accountsQ.refetch;

  // /me/link 가 실어 온 결과(linked, link_error) 를 토스트로 보이고 주소에서 지운다
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    const result = readLinkResult(new URLSearchParams(params.toString()));
    if (!result && !params.has("provider")) return;
    shown.current = true;
    if (result && params.get("link_error") !== "REAUTH_REQUIRED") toast.show(result.message);
    router.replace(pathname, { scroll: false });
  }, [params, pathname, router, toast]);

  const onLinkedEmail = useCallback(
    (absorbed: boolean) => {
      setEmailOpen(false);
      toast.show(linkedMessage("EMAIL", absorbed));
      void refetch();
    },
    [refetch, toast],
  );

  const onLinkedApp = useCallback(
    (provider: AppLinkProvider, absorbed: boolean) => {
      toast.show(linkedMessage(provider, absorbed));
      void refetch();
    },
    [refetch, toast],
  );

  const onAppLinkFailed = useCallback(
    (message: string, refresh: boolean) => {
      toast.show(message);
      if (refresh) void refetch();
    },
    [refetch, toast],
  );

  async function confirmUnlink() {
    if (!target) return;
    const r = await unlink.mutate(target.id);
    if (r.ok) {
      toast.show(`${PROVIDER_NAME[target.provider] ?? "로그인 방법"} 연결을 해제했어요`);
      setTarget(null);
      void refetch();
      return;
    }
    setTarget(null);
    toast.show(
      r.error.code === "KAKAO_ERROR" || r.error.code === "APPLE_ERROR"
        ? `${PROVIDER_NAME[target.provider]} 연결을 끊지 못했어요. 잠시 후 다시 시도해 주세요`
        : linkErrorMessage(r.error.code) || messageOf(r.error, "해제하지 못했어요"),
    );
    if (r.error.code === "LAST_AUTH_ACCOUNT") void refetch();
  }

  const linked = accounts?.map((a) => a.provider) ?? [];
  const choices: LinkProvider[] = accounts ? linkableProviders({ inApp, appLink, appleEnabled, emailEnabled, linked }) : [];
  const canUnlink = (accounts?.length ?? 0) > 1;

  return (
    <div>
      <ScreenHeader title="로그인 방법" fallbackHref="/me" backLabel="내 정보로" />

      <div className="mt-3 space-y-5 main-lg:grid main-lg:grid-cols-2 main-lg:items-start main-lg:gap-3 main-lg:space-y-0">
        {accountsQ.error && !accounts ? (
          <ErrorState message={messageOf(accountsQ.error, "로그인 방법을 불러오지 못했어요")} onRetry={refetch} />
        ) : (
          <div aria-busy={!accounts || undefined}>
            <RowGroup title="연결된 방법" hint="어느 방법으로 로그인해도 같은 달력이에요">
              {accounts
                ? accounts.map((a) => <AccountRow key={a.id} account={a} canUnlink={canUnlink} onUnlink={() => setTarget(a)} />)
                : [0, 1].map((i) => (
                    <div key={i} className="flex min-h-11 items-center py-1">
                      <span className="flex-1">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="mt-1.5 h-3 w-28" />
                      </span>
                    </div>
                  ))}
            </RowGroup>
          </div>
        )}

        {choices.length > 0 && (
          <RowGroup title="다른 방법 연결" hint="연결하려면 그 방법으로 한 번 더 로그인해요">
            {choices.map((p) =>
              p === "EMAIL" ? (
                <button key={p} type="button" className={rowClass} onClick={() => setEmailOpen(true)}>
                  <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center text-ink-2">
                    <IconPlus size={16} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">이메일 연결</span>
                </button>
              ) : inApp && appLink ? (
                // 앱 안: 셸이 /auth/kakao 이동을 가로채므로 웹 OAuth 대신 브리지 (linkableProviders 가 AccountLink/1 일 때만 넘긴다)
                <AppLinkRow
                  key={p}
                  provider={p}
                  onLinked={(absorbed) => onLinkedApp(p, absorbed)}
                  onFailed={onAppLinkFailed}
                  onReauth={() => setReauthOpen(true)}
                />
              ) : (
                <OAuthLinkRow key={p} provider={p} />
              ),
            )}
          </RowGroup>
        )}
      </div>

      <ConfirmDialog
        open={target !== null}
        title={`${target ? (PROVIDER_NAME[target.provider] ?? "") : ""} 연결을 해제할까요?`}
        body={target ? unlinkConfirmBody(target.provider) : undefined}
        confirmLabel="해제"
        danger
        loading={unlink.isPending}
        onConfirm={() => void confirmUnlink()}
        onCancel={() => setTarget(null)}
      />
      <ConfirmDialog
        open={reauthOpen}
        title="다시 로그인해 주세요"
        body="보안을 위해 최근에 로그인한 상태에서만 연결할 수 있어요"
        confirmLabel="다시 로그인"
        neutral
        onConfirm={reauth}
        onCancel={() => setReauthOpen(false)}
      />
      {emailOpen && (
        <EmailLinkSheet
          open
          onClose={() => setEmailOpen(false)}
          onLinked={onLinkedEmail}
          onReauth={() => {
            setEmailOpen(false);
            setReauthOpen(true);
          }}
        />
      )}
    </div>
  );
}
