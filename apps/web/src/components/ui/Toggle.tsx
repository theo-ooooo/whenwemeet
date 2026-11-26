"use client";
import { SwitchTrack } from "./SwitchTrack";

/* ---------- 토글 ---------- */

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-4 rounded-sm py-1 text-left"
    >
      <span>
        <span className="block text-[14px] font-semibold">{label}</span>
        {description && <span className="t-sub block">{description}</span>}
      </span>
      <SwitchTrack checked={checked} />
    </button>
  );
}
