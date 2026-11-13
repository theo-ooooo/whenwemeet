"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Symbol } from "@/components/Logo";
import { Button, Field, inputClass } from "@/components/ui";
import { messageOf, useCreateGroup } from "@/hooks";
import { rememberGroup } from "@/lib/group-cookie";
import { teamHref } from "@/lib/routes";
import { saveStart } from "@/lib/start-guide";
import { nameForChip, PRESET_CHIPS, startHref, type PresetKey } from "@/lib/team-preset";

export function NewGroupScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  // (#278) 쓰임. null = 직접 정하기(지금 흐름). 서버에 저장하지 않는다 (D-250)
  const [preset, setPreset] = useState<PresetKey | null>(null);
  // 성공 뒤 팀 설정으로 이동하므로 이동 중 버튼을 로딩으로 둔다
  const { mutate, isPending: loading, error: failure } = useCreateGroup({ keepPendingAfterSuccess: true });
  const error = failure ? messageOf(failure, "팀을 만들지 못했어요. 다시 시도해 주세요") : null;
  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 30;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || loading) return;
    let r = await mutate(preset ? { name: trimmed, preset } : { name: trimmed });
    // 쓰임(preset)을 모르는 옛 API 는 낯선 항목이라 400 을 준다 (배포 사이). 쓰임 없이 한 번 더: 서버는 어차피 저장하지 않는다
    if (!r.ok && preset && r.error.status === 400) r = await mutate({ name: trimmed });
    if (!r.ok) return;
    rememberGroup(r.data.id);
    if (!preset) {
      router.replace(teamHref({ invite: true }));
      return;
    }
    // 첫 단계를 건너뛰어도 달력에서 다시 안내하도록 이 기기에 남긴다
    saveStart(r.data.id, preset);
    router.replace(startHref(preset));
  }

  function pick(next: PresetKey | null) {
    setName((cur) => nameForChip(cur, preset, next));
    setPreset(next);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] lg:pt-6">
      <div className="flex items-center justify-between">
        {/* 진입 화면 공통: 바탕 --bg, 로고 32, 제목 28/36, 좌우 24 (#174 L4) */}
        <Symbol size={32} />
        <Link href="/" className="hit flex h-8 items-center rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95">
          닫기
        </Link>
      </div>

      <form onSubmit={submit} className="mt-8 flex flex-1 flex-col">
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">
          어떤 모임의
          <br />
          달력인가요?
        </h1>
        <p className="mt-2 text-[14px] leading-5 text-soft">고르면 시작을 도와 드려요. 안 골라도 괜찮아요</p>

        <PresetChips value={preset} onChange={pick} />

        <div className="mt-4 rounded-xl bg-paper px-3.5 py-3.5">
          <Field label="팀 이름" hint={`${trimmed.length}/30`} error={error}>
            {(id, describedBy) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                autoFocus
                autoComplete="off"
                enterKeyHint="done"
                placeholder="예: 우리 둘, 김씨네, 목요 스터디"
              />
            )}
          </Field>
        </div>

        <div className="mt-auto pt-8">
          <Button type="submit" size="lg" full disabled={!valid} loading={loading}>
            만들기
          </Button>
          {/* 이미 있는 팀에 들어갈 사람은 만들지 않고 코드로 합류 (#56) */}
          <Link href="/join" className="mt-2 flex h-11 items-center justify-center rounded-md text-[13.5px] font-bold text-ink-2 hover:text-ink">
            초대 코드를 받았나요? 코드로 합류하기
          </Link>
        </div>
      </form>
    </main>
  );
}

/**
 * (#278) 쓰임 칩 한 줄 (가로로 넘김). 높이 36, 알약, 고른 칩은 먹색 면 + --on-ink 글자 (디자인규칙 4-1 선택 표현).
 * radiogroup: 고른 칩만 Tab, 화살표 Home End 로 옮기며 고른다
 */
function PresetChips({ value, onChange }: { value: PresetKey | null; onChange: (v: PresetKey | null) => void }) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = PRESET_CHIPS.findIndex((c) => c.key === value);

  function onKey(e: React.KeyboardEvent, i: number) {
    const last = PRESET_CHIPS.length - 1;
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (to === null) return;
    e.preventDefault();
    onChange(PRESET_CHIPS[to].key);
    refs.current[to]?.focus();
  }

  return (
    <div className="mt-6">
      <span id={labelId} className="sr-only">
        어떤 모임인가요
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none]">
        {PRESET_CHIPS.map((c, i) => {
          const on = i === current;
          return (
            <button
              key={c.label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(c.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={`anim-pick h-9 shrink-0 rounded-full px-4 text-[14px] whitespace-nowrap ${
                on ? "bg-ink font-bold text-on-ink" : "bg-paper font-medium text-ink hover:brightness-95"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
