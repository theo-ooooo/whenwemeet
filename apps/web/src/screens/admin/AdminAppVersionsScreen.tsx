"use client";
// (#539) 관리자 "앱 버전" (D-292). 기종(iOS, Android)마다 최신 버전, 최소 버전, 스토어 주소를 고친다.
// 최신보다 낮은 앱은 "새 버전이 나왔어요"(버전마다 한 번 닫을 수 있음), 최소보다 낮은 앱은 닫을 수 없는 "업데이트가 필요해요".
// 빈 칸은 지움(null): 버전이 없으면 그 안내를 하지 않고, 스토어 주소가 없으면 기본 주소. 저장마다 조치 기록 한 줄
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { Button, ErrorState, Field, InlineError, Skeleton, inputClass } from "@/components/ui";
import { messageOf, useAdminAppReleases, useUpdateAppRelease } from "@/hooks";
import { adminDateTime, adminPlatformName } from "@/lib/admin";
import { compareVersions, storeName, VERSION_PATTERN } from "@/lib/app-version";
import type { AppRelease } from "@/lib/types";

export function AdminAppVersionsScreen() {
  const q = useAdminAppReleases();
  return (
    <div className="max-w-[960px]">
      <AdminTitle title="앱 버전" sub="앱이 이 버전보다 낮으면 업데이트를 안내해요. 웹 브라우저에는 보이지 않아요" />
      {q.error && !q.data ? (
        <ErrorState message={messageOf(q.error, "앱 버전을 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !q.data ? (
        <div className="grid gap-3 fold:grid-cols-2" aria-busy="true" aria-label="불러오는 중">
          <Skeleton className="h-[320px] w-full rounded-xl" />
          <Skeleton className="h-[320px] w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-3 fold:grid-cols-2">
          {q.data.map((r) => (
            <ReleaseForm
              key={r.platform}
              release={r}
              onSaved={(next) => q.setData((rows) => rows?.map((x) => (x.platform === next.platform ? next : x)) ?? null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 빈 칸 → null, 그 밖은 앞뒤 공백을 자른 값 */
const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

function versionError(v: string): string | null {
  return v.trim() === "" || VERSION_PATTERN.test(v.trim()) ? null : "1.4.0 처럼 숫자와 점으로 적어 주세요";
}

function ReleaseForm({ release, onSaved }: { release: AppRelease; onSaved: (next: AppRelease) => void }) {
  const [latest, setLatest] = useState(release.latestVersion ?? "");
  const [min, setMin] = useState(release.minVersion ?? "");
  const [store, setStore] = useState(release.storeUrl);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const update = useUpdateAppRelease();
  const name = adminPlatformName(release.platform);
  const latestErr = versionError(latest);
  const minErr =
    versionError(min) ??
    (!versionError(latest) && latest.trim() && min.trim() && compareVersions(min, latest) > 0 ? "최소 버전은 최신 버전보다 높을 수 없어요" : null);
  const storeErr = store.trim() === "" || /^https:\/\/\S+$/.test(store.trim()) ? null : "https 로 시작하는 주소를 넣어 주세요";
  const invalid = Boolean(latestErr || minErr || storeErr);

  async function save() {
    setError(null);
    setSaved(false);
    if (invalid) return;
    const r = await update.mutate({ platform: release.platform, latestVersion: orNull(latest), minVersion: orNull(min), storeUrl: orNull(store) });
    if (!r.ok) {
      setError(messageOf(r.error, "저장하지 못했어요. 잠시 후 다시 시도해 주세요"));
      return;
    }
    setSaved(true);
    onSaved(r.data);
  }

  return (
    <section aria-labelledby={`release-${release.platform}`} className="space-y-4 rounded-xl bg-paper px-4 py-5">
      <div>
        <h2 id={`release-${release.platform}`} className="text-[17px] font-bold leading-6">
          {name}
        </h2>
        <p className="t-sub">{release.updatedAt ? `마지막 변경 ${adminDateTime(release.updatedAt)}` : "아직 정하지 않았어요 (안내 없음)"}</p>
      </div>
      <Field label="최신 버전" hint="이보다 낮으면 '새 버전이 나왔어요' (닫을 수 있음)" error={latestErr}>
        {(fid, describedBy) => (
          <input
            id={fid}
            aria-describedby={describedBy}
            inputMode="decimal"
            placeholder="예: 1.4.0"
            className={inputClass}
            value={latest}
            onChange={(e) => setLatest(e.target.value)}
          />
        )}
      </Field>
      <Field label="최소 버전" hint="이보다 낮으면 '업데이트가 필요해요' (닫을 수 없음)" error={minErr}>
        {(fid, describedBy) => (
          <input
            id={fid}
            aria-describedby={describedBy}
            inputMode="decimal"
            placeholder="예: 1.1.0"
            className={inputClass}
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        )}
      </Field>
      <Field label={`${storeName(release.platform)} 주소`} hint="비우면 기본 주소" error={storeErr}>
        {(fid, describedBy) => (
          <input id={fid} aria-describedby={describedBy} inputMode="url" className={inputClass} value={store} onChange={(e) => setStore(e.target.value)} />
        )}
      </Field>
      {error && <InlineError>{error}</InlineError>}
      <div className="flex items-center gap-3 pt-1">
        {saved && !update.isPending && (
          <span role="status" className="t-sub">
            저장했어요
          </span>
        )}
        <Button className="ml-auto" loading={update.isPending} disabled={invalid} onClick={() => void save()}>
          {name} 저장
        </Button>
      </div>
    </section>
  );
}
