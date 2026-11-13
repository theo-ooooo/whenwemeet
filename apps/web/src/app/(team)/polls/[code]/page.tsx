import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeamScope } from "@/components/AppShell";
import { lookupPoll } from "@/lib/poll-lookup";
import { parsePublicCode } from "@/lib/routes";
import { PollScreen } from "@/screens/PollScreen";

export const metadata: Metadata = { title: "약속 투표" };

/**
 * (#189) 약속 투표 `/polls/<투표 공개 코드>`. 주소에 팀이 없으므로 서버가 코드로 투표를 찾아 팀을 알아내고
 * TeamScope 로 그 팀에 맞춘다 (할 일 목록 상세와 같은 방식). 없거나 내 팀 투표가 아니면 404
 */
export default async function PollPage({ params }: { params: Promise<{ code: string }> }) {
  const code = parsePublicCode((await params).code);
  if (code === null) notFound();
  const poll = await lookupPoll(code);
  if (!poll) notFound();
  return (
    <TeamScope groupId={poll.groupId}>
      <PollScreen code={code} initial={poll} />
    </TeamScope>
  );
}
