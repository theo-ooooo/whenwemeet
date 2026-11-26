"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Symbol } from "@/components/Logo";
import { NameField } from "@/components/NameField";
import { Button, RowGroup } from "@/components/ui";
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
    <main className="mx-auto flex min-h-dvh w-full fold:max-w-[480px] flex-col px-6 pb-[calc(24px+var(--sab))] pt-[max(12px,var(--sat))] lg:pt-6">
      <div className="flex items-center justify-between">
        {/* 진입 화면 공통: 바탕 --bg, 로고 32, 제목 28/36, 좌우 24 (#174 L4) */}
        <Symbol size={32} />
        <Link href="/" className="hit flex h-8 items-center rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95">
          닫기
        </Link>
      </div>

      {/* (#378) 큰 제목 → 이름 칸(라벨 없음, 글자 수는 80% 부터) → 쓰임 세그먼트 → 바로 아래 만들기. 버튼을 화면 맨 아래로 떨어뜨리지 않는다 */}
      <form onSubmit={submit} className="mt-8 flex flex-col">
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.03em]">
          어떤 모임의
          <br />
          달력인가요?
        </h1>

        <RowGroup className="mt-6">
          <NameField
            label="팀 이름"
            value={name}
            onChange={setName}
            max={30}
            limitInput
            autoFocus
            autoComplete="off"
            enterKeyHint="done"
            placeholder="예: 우리 둘, 김씨네, 목요 스터디"
            error={error}
          />
        </RowGroup>

        <RowGroup className="mt-2" hint="고르면 시작을 도와 드려요. 안 골라도 괜찮아요">
          <PresetChips value={preset} onChange={pick} />
        </RowGroup>

        <div className="mt-5">
          <Button type="submit" size="xl" full disabled={!valid} loading={loading}>
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
 * (#278) 쓰임 고르기. (#378) 카드 안 세그먼트 한 줄(5칸, 기념일 종류와 같은 모양). "직접" 은 쓰임 없음(null) = 지금 흐름.
 * radiogroup: 고른 칸만 Tab, 화살표 Home End 로 옮기며 고른다
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
    <div className="pb-3 pt-2.5">
      <span id={labelId} className="mb-2 block text-[14px] font-semibold">
        용도
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-5 gap-1 rounded-sm bg-surface p-1">
        {PRESET_CHIPS.map((c, i) => {
          const on = i === current;
          // 칸이 좁아 "직접 정하기" 는 "직접" 으로 보이고 읽기 이름은 그대로
          const short = c.key === null ? "직접" : c.label;
          return (
            <button
              key={c.label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={short === c.label ? undefined : c.label}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(c.key)}
              onKeyDown={(e) => onKey(e, i)}
              className={`anim-pick hit flex h-9 min-w-0 items-center justify-center rounded-[8px] border px-0.5 text-[13px] whitespace-nowrap ${
                on
                  ? "border-[var(--seg-edge)] bg-[var(--seg-on)] font-bold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "border-transparent font-medium text-soft hover:text-ink"
              }`}
            >
              {short}
            </button>
          );
        })}
      </div>
    </div>
  );
}
