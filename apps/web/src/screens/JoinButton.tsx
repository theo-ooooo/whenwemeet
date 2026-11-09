"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { rememberGroup } from "@/lib/group-cookie";
import type { GroupDetail } from "@/lib/types";

export function JoinButton({ code }: { code: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setLoading(true);
    setError(null);
    try {
      const group = await api<GroupDetail>("/groups/join", { method: "POST", body: { code } });
      rememberGroup(group.id);
      router.replace(`/g/${group.id}/calendar`);
    } catch (e) {
      setError(messageOf(e, "합류하지 못했어요. 다시 시도해 주세요"));
      setLoading(false);
    }
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 text-[14px] text-danger">
          {error}
        </p>
      )}
      <Button size="lg" full loading={loading} onClick={join}>
        합류하기
      </Button>
    </div>
  );
}
