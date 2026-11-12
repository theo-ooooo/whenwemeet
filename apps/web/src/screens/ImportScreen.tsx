"use client";
// (#279) 일정 가져오기 (설계 `일정-가져오기.md` 5장). 파일 고르기 → 미리보기(팀, 참여자, 기간) → 완료.
// 파일은 화면 메모리에만 두고 미리보기와 넣기에서 두 번 올린다 (서버는 저장하지 않는다).
// (#314) 미리보기 달력에서 골라서 넣는다. 미리보기를 새로 받으면(파일, 팀, 기간) 다시 전부 선택
import Link from "next/link";
import { CALENDAR_PATH, TEAM_PATH, withTeam } from "@/lib/routes";
import { useRouter } from "next/navigation";
import { useId, useReducer, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { ImportCalendar } from "@/components/ImportCalendar";
import { Button, inputClass, Segmented } from "@/components/ui";
import { messageOf, useImportEvents, usePreviewImport, type ImportInput } from "@/hooks";
import { excludedLine, includeKeys, selectedCount, selectReducer, submitLabel } from "@/lib/import-select";
import { doneHeadline, ICS_MAX_BYTES, looksLikeIcs, previewHeadline, previewLines, SKIP_LABEL, warningLines } from "@/lib/import-copy";
import { useInApp } from "@/lib/useInApp";
import type { ImportParticipants, ImportPreview, ImportRange, ImportResult } from "@/lib/types";

const READ_FAILED = "캘린더 파일(.ics)을 읽지 못했어요";
const NONE_EXCLUDED: ReadonlySet<string> = new Set();

type Step = { kind: "pick" } | { kind: "preview"; preview: ImportPreview } | { kind: "done"; result: ImportResult; groupId: number; excluded: number };

export function ImportScreen() {
  const router = useRouter();
  const { groupId, groups, eventsChanged } = useGroupContext();
  const inApp = useInApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState(groupId);
  const [range, setRange] = useState<ImportRange>("future");
  const [participants, setParticipants] = useState<ImportParticipants | null>(null);
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  // 뺀 일정의 key. 비어 있으면 전부 선택
  const [excluded, dispatch] = useReducer(selectReducer, NONE_EXCLUDED);
  const [previewSeq, setPreviewSeq] = useState(0);
  const previewQ = usePreviewImport();
  const importQ = useImportEvents({ keepPendingAfterSuccess: false });
  const ids = { team: useId(), who: useId(), range: useId() };

  const targetGroup = groups?.find((g) => g.id === target);
  const isTeam = targetGroup ? targetGroup.type === "TEAM" : true;
  // 팀은 "모두", 개인 달력은 나 (기획 Q4). 사용자가 고르면 그 값
  const who: ImportParticipants = isTeam ? (participants ?? "ALL") : "ME";

  async function runPreview(next: { file: File; groupId: number; range: ImportRange }) {
    setError(null);
    const r = await previewQ.mutate({
      groupId: next.groupId,
      file: next.file,
      range: next.range,
    });
    if (!r.ok) {
      setError(messageOf(r.error, READ_FAILED));
      return;
    }
    // 파일, 팀, 기간이 바뀌면 고른 것을 잊고 다시 전부 (단순하게, #314)
    dispatch({ type: "reset" });
    setPreviewSeq((n) => n + 1);
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
    if (!file || step.kind !== "preview") return;
    setError(null);
    const items = step.preview.items;
    // 고른 key 를 늘 보낸다 (미리보기와 넣기 사이에 남은 것이 바뀌어도 고른 것만 들어가게)
    const input: ImportInput = {
      groupId: target,
      file,
      range,
      participants: who,
      include: includeKeys(items, excluded),
    };
    const left = items.length - input.include!.length;
    const r = await importQ.mutate(input);
    if (!r.ok) {
      setError(messageOf(r.error, "일정을 넣지 못했어요. 다시 시도해 주세요"));
      // 중간에 실패했으면 들어간 만큼 줄어든 목록을 다시 보여 준다 (다시 넣으면 나머지만). 뺀 것은 그대로 뺀 채로 둔다
      if (r.error.code === "IMPORT_INCOMPLETE") {
        const again = await previewQ.mutate({ groupId: target, file, range });
        if (again.ok) setStep({ kind: "preview", preview: again.data });
      }
      return;
    }
    if (target === groupId) eventsChanged();
    setStep({ kind: "done", result: r.data, groupId: target, excluded: left });
  }

  function reset() {
    setFile(null);
    setError(null);
    setStep({ kind: "pick" });
  }

  return (
    // (#314) 다른 팀 화면처럼 본문 폭을 다 쓴다 (D-100). lg 는 왼쪽 조건 340(xl 400) + 오른쪽 달력, 그 아래는 위아래 1단
    <div className="w-full space-y-2 pt-1">
      <div className="flex h-10 items-center justify-between">
        <h1 className="t-title">일정 가져오기</h1>
        <Link href={TEAM_PATH} className="hit flex h-8 items-center rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95">
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
        <div className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
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
        </div>
      )}

      {step.kind === "preview" && (
        // lg: 1열 1행 조건, 1열 2행 넣기 줄(위에 붙어 따라옴), 2열 달력. 폰과 폴드는 DOM 순서대로 조건 → 달력 → 바닥 넣기 줄
        <div className="space-y-2 lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-5 lg:gap-y-2 lg:space-y-0 xl:grid-cols-[400px_minmax(0,1fr)]">
          <div className="space-y-2 lg:col-start-1 lg:row-start-1">
            <PreviewSection preview={step.preview} loading={previewQ.isPending} fileName={file?.name ?? ""} onOtherFile={() => fileRef.current?.click()}>
              <div className="space-y-3">
                <div>
                  <label htmlFor={ids.team} className="text-[13px] font-bold leading-5">
                    넣을 팀
                  </label>
                  <select id={ids.team} value={target} onChange={(e) => changeTarget(Number(e.target.value))} className={`${inputClass} mt-1 appearance-none`}>
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
                        { value: "all", label: "전체" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            </PreviewSection>
          </div>

          {step.preview.items.length > 0 && (
            <section className="rounded-xl bg-paper px-2 pb-1.5 fold:px-3.5 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="넣을 일정">
              {/* 미리보기마다 새로 만들어 첫 달부터 (key = 미리보기 객체가 바뀔 때마다 늘어나는 번호) */}
              <ImportCalendar key={previewSeq} items={step.preview.items} excluded={excluded} dispatch={dispatch} />
            </section>
          )}

          {/* 폰은 독을 숨긴 자리에 넣기 줄을 바닥에 붙인다 (일정 작성과 같다). 폴드도 달력 아래 바닥에, lg 는 왼쪽 조건 아래에서 위에 붙어 따라온다 */}
          <div className="sticky bottom-0 z-10 -mx-5 bg-surface px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2 fold:mx-0 fold:px-0 lg:top-7 lg:bottom-auto lg:col-start-1 lg:row-start-2 lg:bg-transparent lg:p-0">
            {error && (
              <p role="alert" className="mb-2 text-[13px] leading-5 text-danger">
                {error}
              </p>
            )}
            <SubmitButton
              teamName={targetGroup?.name ?? "이 팀"}
              selected={selectedCount(step.preview.items, excluded)}
              total={step.preview.items.length}
              loading={importQ.isPending}
              disabled={previewQ.isPending}
              onClick={() => void submit()}
            />
          </div>
        </div>
      )}

      {step.kind === "done" && (
        <section className="rounded-xl bg-paper px-3.5 py-3.5" aria-live="polite">
          <p className="text-[20px] font-bold leading-7">{doneHeadline(step.result.created)}</p>
          {excludedLine(step.excluded) && <p className="t-sub">{excludedLine(step.excluded)}</p>}
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
            {/* (#311) 다른 팀에 넣었으면 `?team=` 으로 그 팀 달력을 연다 (AppShell 이 쿠키를 바꾼다) */}
            <Button onClick={() => router.push(step.groupId === groupId ? CALENDAR_PATH : withTeam(CALENDAR_PATH, groups?.find((g) => g.id === step.groupId)?.publicCode ?? ""))}>
              달력 보기
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/** 미리보기 카드: 큰 수, 반복 유지와 나눔, 기간, 건너뜀 이유, 경고 + 아래에 고르는 칸(children). 일정 목록은 따로 (#314) */
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
          <button
            type="button"
            onClick={onOtherFile}
            className="hit mt-1 shrink-0 text-[12px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
          >
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
      </section>
      <section className="rounded-xl bg-paper px-3.5 py-3.5">{children}</section>
    </>
  );
}

/** 넣기 버튼. 고른 수를 보이고 0개면 비활성 */
function SubmitButton({
  teamName,
  selected,
  total,
  loading,
  disabled,
  onClick,
}: {
  teamName: string;
  selected: number;
  total: number;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button full size="lg" loading={loading} disabled={disabled || selected === 0} onClick={onClick}>
      <span className="truncate">{submitLabel(teamName, selected, total)}</span>
    </Button>
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
