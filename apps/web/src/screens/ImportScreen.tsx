"use client";
// (#279) 일정 가져오기 (설계 `일정-가져오기.md` 5장). 파일 고르기 → 미리보기(팀, 참여자, 기간) → 완료.
// 파일은 화면 메모리에만 두고 미리보기와 넣기에서 두 번 올린다 (서버는 저장하지 않는다)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { Button, inputClass, Segmented } from "@/components/ui";
import { messageOf, useImportEvents, usePreviewImport, type ImportInput } from "@/hooks";
import { dateKeyOf, formatDateKo, formatEventTime } from "@/lib/date";
import { doneHeadline, ICS_MAX_BYTES, looksLikeIcs, previewHeadline, previewLines, SKIP_LABEL, warningLines } from "@/lib/import-copy";
import { useInApp } from "@/lib/useInApp";
import type { ImportParticipants, ImportPreview, ImportRange, ImportResult } from "@/lib/types";

const READ_FAILED = "캘린더 파일(.ics)을 읽지 못했어요";
const REPEAT_NAME = { WEEKLY: "매주", BIWEEKLY: "격주", MONTHLY: "매월", YEARLY: "매년" } as const;

type Step = { kind: "pick" } | { kind: "preview"; preview: ImportPreview } | { kind: "done"; result: ImportResult; groupId: number };

export function ImportScreen({ groupId }: { groupId: number }) {
  const router = useRouter();
  const { groups, eventsChanged } = useGroupContext();
  const inApp = useInApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState(groupId);
  const [range, setRange] = useState<ImportRange>("future");
  const [participants, setParticipants] = useState<ImportParticipants | null>(null);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const previewQ = usePreviewImport();
  const importQ = useImportEvents({ keepPendingAfterSuccess: false });
  const ids = { team: useId(), who: useId(), range: useId() };

  const targetGroup = groups?.find((g) => g.id === target);
  const isTeam = targetGroup ? targetGroup.type === "TEAM" : true;
  // 팀은 "모두", 개인 달력은 나 (기획 Q4). 사용자가 고르면 그 값
  const who: ImportParticipants = isTeam ? (participants ?? "ALL") : "ME";

  async function runPreview(next: { file: File; groupId: number; range: ImportRange }) {
    setError(null);
    const r = await previewQ.mutate({ groupId: next.groupId, file: next.file, range: next.range });
    if (!r.ok) {
      setError(messageOf(r.error, READ_FAILED));
      return;
    }
    setStep({ kind: "preview", preview: r.data });
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    if (!looksLikeIcs(chosen)) {
      setError("캘린더 파일(.ics)을 골라 주세요");
      return;
    }
    if (chosen.size > ICS_MAX_BYTES) {
      setError("파일이 너무 커요. 2MB 까지 올릴 수 있어요");
      return;
    }
    setFile(chosen);
    void runPreview({ file: chosen, groupId: target, range });
  }

  function changeTarget(id: number) {
    setTarget(id);
    if (file) void runPreview({ file, groupId: id, range });
  }

  function changeRange(next: ImportRange) {
    setRange(next);
    if (file) void runPreview({ file, groupId: target, range: next });
  }

  async function submit() {
    if (!file) return;
    setError(null);
    const input: ImportInput = { groupId: target, file, range, participants: who };
    const r = await importQ.mutate(input);
    if (!r.ok) {
      setError(messageOf(r.error, "일정을 넣지 못했어요. 다시 시도해 주세요"));
      // 중간에 실패했으면 들어간 만큼 줄어든 수를 다시 보여 준다 (다시 넣으면 나머지만)
      if (r.error.code === "IMPORT_INCOMPLETE") {
        const again = await previewQ.mutate({ groupId: target, file, range });
        if (again.ok) setStep({ kind: "preview", preview: again.data });
      }
      return;
    }
    if (target === groupId) eventsChanged();
    setStep({ kind: "done", result: r.data, groupId: target });
  }

  function reset() {
    setFile(null);
    setError(null);
    setStep({ kind: "pick" });
  }

  return (
    // 단독 화면처럼 fold 이상 폭 480 가운데 (디자인규칙 2-2)
    <div className="mx-auto w-full space-y-2 pt-1 fold:max-w-[480px]">
      <div className="flex h-10 items-center justify-between">
        <h1 className="t-title">일정 가져오기</h1>
        <Link href={`/g/${groupId}/settings`} className="hit flex h-8 items-center rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95">
          팀 설정
        </Link>
      </div>

      <input
        ref={fileRef}
        type="file"
        // 앱 웹뷰(iOS 파일 앱)는 .ics 를 흐리게 보여 고를 수 없는 경우가 있어 넓히고, 고른 뒤 이름으로 거른다
        accept={inApp ? undefined : ".ics,text/calendar"}
        hidden
        onChange={pick}
      />

      {step.kind === "pick" && (
        <>
          <section className="rounded-xl bg-paper px-3.5 py-3.5">
            <p className="text-[14px] leading-5 text-soft">
              다른 캘린더에서 내보낸 .ics 파일을 올리면 일정을 한 번에 넣어요. 같은 파일을 다시 올려도 이미 넣은 일정은 다시 들어가지 않아요
            </p>
            <Button full className="mt-3" loading={previewQ.isPending} onClick={() => fileRef.current?.click()}>
              파일 고르기
            </Button>
            {error && (
              <p role="alert" className="mt-2 text-[13px] leading-5 text-danger">
                {error}
              </p>
            )}
          </section>
          <SourceHelp />
        </>
      )}

      {step.kind === "preview" && (
        <PreviewSection
          preview={step.preview}
          loading={previewQ.isPending}
          fileName={file?.name ?? ""}
          onOtherFile={() => fileRef.current?.click()}
        >
          <div className="space-y-3">
            <div>
              <label htmlFor={ids.team} className="text-[13px] font-bold leading-5">
                넣을 팀
              </label>
              <select
                id={ids.team}
                value={target}
                onChange={(e) => changeTarget(Number(e.target.value))}
                className={`${inputClass} mt-1 appearance-none`}
              >
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.type === "PERSONAL" ? `${g.name} (개인 달력)` : g.name}
                  </option>
                ))}
              </select>
              {isTeam && <p className="t-sub mt-1">남과 같이 볼 일정만 팀에 넣으세요. 내 일정은 개인 달력이 좋아요</p>}
            </div>
            {isTeam && (
              <div>
                <p id={ids.who} className="text-[13px] font-bold leading-5">
                  참여자
                </p>
                <div className="mt-1">
                  <Segmented
                    labelledBy={ids.who}
                    value={who}
                    onChange={setParticipants}
                    options={[
                      { value: "ALL", label: "모두" },
                      { value: "ME", label: "나만" },
                    ]}
                  />
                </div>
                <p className="t-sub mt-1">{who === "ALL" ? "팀원 모두의 빈 시간에 바쁨으로 잡혀요" : "내 빈 시간에만 바쁨으로 잡혀요"}</p>
              </div>
            )}
            <div>
              <p id={ids.range} className="text-[13px] font-bold leading-5">
                기간
              </p>
              <div className="mt-1">
                <Segmented
                  labelledBy={ids.range}
                  value={range}
                  onChange={changeRange}
                  options={[
                    { value: "future", label: "오늘 이후" },
                    { value: "year", label: "지난 1년부터" },
                  ]}
                />
              </div>
            </div>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-[13px] leading-5 text-danger">
              {error}
            </p>
          )}
          <Button
            full
            size="lg"
            className="mt-3"
            loading={importQ.isPending}
            disabled={previewQ.isPending || step.preview.toCreate === 0}
            onClick={() => void submit()}
          >
            {step.preview.toCreate > 0 ? `${targetGroup?.name ?? "이 팀"}에 ${step.preview.toCreate.toLocaleString("en-US")}개 넣기` : "넣을 일정이 없어요"}
          </Button>
        </PreviewSection>
      )}

      {step.kind === "done" && (
        <section className="rounded-xl bg-paper px-3.5 py-3.5" aria-live="polite">
          <p className="text-[20px] font-bold leading-7">{doneHeadline(step.result.created)}</p>
          {step.result.skipped.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {step.result.skipped.map((s) => (
                <li key={s.reason} className="t-sub">
                  {SKIP_LABEL[s.reason]} {s.count.toLocaleString("en-US")}개는 건너뛰었어요
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={reset}>
              다른 파일 넣기
            </Button>
            <Button onClick={() => router.push(`/g/${step.groupId}/calendar`)}>달력 보기</Button>
          </div>
        </section>
      )}
    </div>
  );
}

/** 미리보기 카드: 큰 수, 반복 유지와 나눔, 기간, 건너뜀 이유, 경고, 예시 5개 + 아래에 고르는 칸(children) */
function PreviewSection({
  preview,
  loading,
  fileName,
  onOtherFile,
  children,
}: {
  preview: ImportPreview;
  loading: boolean;
  fileName: string;
  onOtherFile: () => void;
  children: React.ReactNode;
}) {
  const lines = previewLines(preview);
  const warnings = warningLines(preview);
  return (
    <>
      <section className="rounded-xl bg-paper px-3.5 py-3.5" aria-busy={loading || undefined}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[20px] font-bold leading-7" aria-live="polite">
            {previewHeadline(preview)}
          </p>
          <button type="button" onClick={onOtherFile} className="hit mt-1 shrink-0 text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
            다른 파일
          </button>
        </div>
        <p className="t-sub truncate">{fileName}</p>
        {lines.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[14px] leading-5">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {preview.skipped.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {preview.skipped.map((s) => (
              <li key={s.reason} className="t-sub">
                {SKIP_LABEL[s.reason]} {s.count.toLocaleString("en-US")}개는 건너뛰어요
                {s.reason === "OVER_LIMIT" && ". 같은 파일을 다시 올리면 나머지가 들어가요"}
              </li>
            ))}
          </ul>
        )}
        {warnings.map((w) => (
          <p key={w} className="t-sub mt-1">
            {w}
          </p>
        ))}
        {preview.sample.length > 0 && (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {preview.sample.map((s, i) => (
              <li key={`${s.startsAt}-${i}`} className="flex min-h-11 items-center gap-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{s.title}</span>
                <span className="shrink-0 text-right text-[12px] leading-4 text-ink-2 tabular-nums">
                  {formatDateKo(dateKeyOf(s.startsAt))}
                  <br />
                  {formatEventTime(s.startsAt, s.endsAt, s.allDay)}
                  {s.repeat && `, ${REPEAT_NAME[s.repeat]}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-xl bg-paper px-3.5 py-3.5">{children}</section>
    </>
  );
}

/** "어디서 파일을 받나요?" 접힘. TimeTree 는 공식 내보내기가 없다는 것까지만 (도구 이름은 지원 페이지에만, 기획 Q7) */
function SourceHelp() {
  return (
    <details className="group rounded-xl bg-paper px-3.5">
      <summary className="flex min-h-12 cursor-pointer list-none items-center text-[14px] font-semibold [&::-webkit-details-marker]:hidden">
        어디서 파일을 받나요?
      </summary>
      <div className="space-y-2.5 pb-3.5 text-[13px] leading-5 text-soft">
        <p>
          <b className="text-ink">구글 캘린더</b>: 컴퓨터 웹에서 설정 &gt; 가져오기 및 내보내기 &gt; 내보내기. 받은 zip 을 풀면 캘린더마다 .ics 파일이 있어요
        </p>
        <p>
          <b className="text-ink">애플 캘린더</b>: Mac 캘린더 앱에서 캘린더를 고르고 파일 &gt; 내보내기 &gt; 내보내기
        </p>
        <p>
          <b className="text-ink">네이버 캘린더</b>: 컴퓨터 웹의 캘린더 설정에서 내보내기로 .ics 파일을 받아요
        </p>
        <p>
          <b className="text-ink">TimeTree</b>: 공식 내보내기를 지원하지 않아요. 일정이 적으면 직접 옮기고, .ics 파일이 있다면 여기서 넣을 수 있어요.{" "}
          <Link href="/support#timetree" className="font-semibold text-ink underline underline-offset-2">
            자세히
          </Link>
        </p>
      </div>
    </details>
  );
}
