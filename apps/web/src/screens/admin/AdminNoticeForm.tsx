"use client";
// (#515) 관리자 공지 작성, 수정 (D-285). 제목, 종류, 상단 고정, 본문(일반 텍스트: 빈 줄 = 문단, https 주소 = 링크).
// 새 공지: [초안 저장] [게시]. 초안: [초안 저장] [게시]. 게시된 공지: [게시 취소] [저장]. 삭제는 확인 창
// (#538) "팝업으로 띄우기": 게시된 동안 앱, 웹을 열 때 한 번 창으로 (D-291). 초안에서도 켤 수 있다
// (#528) "푸시로도 알리기": 켜고 [게시]/[저장] 하면 확인 창 뒤 전체 푸시 (D-287). [초안 저장], [게시 취소] 에는 보내지 않는다.
//   한 공지는 한 번만이라 이미 보냈으면 켜진 채 잠기고 "푸시 보냄: 날짜". 서버가 409 를 주면(다른 관리자가 먼저 보냄) 그 문구를 보인다
// (#544) 게시했거나 푸시를 보낸 공지는 "결과" 칸(푸시 발송, 읽은 사람). 넓은 화면(lg)은 오른쪽 열, 그보다 좁으면 폼 아래 (D-293)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminTitle } from "@/components/admin/AdminShell";
import { NoticeBody } from "@/components/NoticeBody";
import { Button, ConfirmDialog, ErrorState, Field, InlineError, RowGroup, Segmented, Skeleton, ToggleRow, inputClass } from "@/components/ui";
import { adminDateTime } from "@/lib/admin";
import { messageOf, useAdminNotice, useCreateNotice, useDeleteNotice, useUpdateNotice, type NoticeInput } from "@/hooks";
import { NOTICE_BODY_MAX, NOTICE_KIND_LABEL, NOTICE_KINDS, NOTICE_TITLE_MAX, noticeDate } from "@/lib/notice";
import type { Notice, NoticeKind } from "@/lib/types";
import { AdminNoticeResults } from "./AdminNoticeResults";

const KIND_OPTIONS = NOTICE_KINDS.map((k) => ({ value: k, label: NOTICE_KIND_LABEL[k] }));

export function AdminNoticeForm({ id }: { id: number | null }) {
  const q = useAdminNotice(id);
  if (id !== null && q.error) return <ErrorState message={messageOf(q.error, "공지를 불러오지 못했어요")} onRetry={q.refetch} />;
  if (id !== null && !q.data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-[320px] w-full rounded-xl" />
      </div>
    );
  }
  return <Form key={q.data?.id ?? "new"} notice={q.data} />;
}

function Form({ notice }: { notice: Notice | null }) {
  const router = useRouter();
  const [title, setTitle] = useState(notice?.title ?? "");
  const [kind, setKind] = useState<NoticeKind>(notice?.kind ?? "notice");
  const [pinned, setPinned] = useState(notice?.pinned ?? false);
  const [popup, setPopup] = useState(notice?.popup ?? false);
  const [body, setBody] = useState(notice?.body ?? "");
  const [preview, setPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [push, setPush] = useState(false);
  const [confirmPush, setConfirmPush] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateNotice({ keepPendingAfterSuccess: true });
  const update = useUpdateNotice({ keepPendingAfterSuccess: true });
  const remove = useDeleteNotice({ keepPendingAfterSuccess: true });
  const busy = create.isPending || update.isPending || remove.isPending;
  const published = Boolean(notice?.publishedAt);
  const pushedAt = notice?.pushedAt ?? null;
  // (#544) 게시된 공지와 푸시를 보낸 공지(게시 취소했어도)만 결과를 보인다
  const showResults = notice !== null && (published || pushedAt !== null);
  const titleOk = title.trim().length >= 1 && title.trim().length <= NOTICE_TITLE_MAX;
  const bodyOk = body.trim().length >= 1 && body.trim().length <= NOTICE_BODY_MAX;

  /** 게시(또는 게시된 공지 저장)일 때만 푸시를 싣는다. 켜져 있으면 먼저 확인 창 */
  function requestSave(publish: boolean) {
    if (publish && push && !pushedAt) {
      setError(null);
      if (!titleOk || !bodyOk) {
        setError("제목과 본문을 입력해 주세요");
        return;
      }
      setConfirmPush(true);
      return;
    }
    void save(publish, false);
  }

  async function save(publish: boolean, withPush: boolean) {
    setError(null);
    if (!titleOk || !bodyOk) {
      setError("제목과 본문을 입력해 주세요");
      return;
    }
    const input: NoticeInput = { title: title.trim(), body, kind, pinned, popup, published: publish, ...(withPush ? { push: true } : {}) };
    const r = notice ? await update.mutate({ id: notice.id, ...input }) : await create.mutate(input);
    setConfirmPush(false);
    if (!r.ok) {
      setError(messageOf(r.error, "저장하지 못했어요. 잠시 후 다시 시도해 주세요"));
      return;
    }
    router.push("/admin/notices");
    router.refresh();
  }

  async function onDelete() {
    if (!notice) return;
    const r = await remove.mutate(notice.id);
    if (!r.ok) {
      setConfirmDelete(false);
      setError(messageOf(r.error, "삭제하지 못했어요"));
      return;
    }
    router.push("/admin/notices");
  }

  return (
    <div className={showResults ? "max-w-[1320px]" : "max-w-[960px]"}>
      <AdminTitle
        title={notice ? "공지 수정" : "새 공지"}
        sub={
          notice
            ? `${published ? `게시 ${noticeDate(notice.publishedAt)}` : "초안 (아직 게시하지 않았어요)"}${pushedAt ? `, 푸시 보냄 ${adminDateTime(pushedAt)}` : ""}`
            : undefined
        }
        right={
          notice && published ? (
            <Link
              href={`/notices/${notice.id}`}
              target="_blank"
              className="hit rounded-sm px-2 py-1 text-[13px] font-semibold text-ink-2 underline underline-offset-2 hover:text-ink"
            >
              공개 화면
            </Link>
          ) : undefined
        }
      />
      <div className={showResults ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start lg:gap-5" : undefined}>
        <div className="min-w-0">
          <div className="space-y-4 rounded-xl bg-paper px-4 py-5">
            <Field label={`제목 (${title.trim().length}/${NOTICE_TITLE_MAX})`}>
              {(fid, describedBy) => (
                <input
                  id={fid}
                  aria-describedby={describedBy}
                  className={inputClass}
                  value={title}
                  maxLength={NOTICE_TITLE_MAX + 20}
                  onChange={(e) => setTitle(e.target.value)}
                />
              )}
            </Field>
            <div>
              <p id="notice-kind" className="mb-1.5 block text-[12px] font-medium leading-4 text-ink-2">
                종류
              </p>
              <Segmented labelledBy="notice-kind" value={kind} options={KIND_OPTIONS} onChange={setKind} />
            </div>
            <RowGroup inset>
              <ToggleRow label="상단 고정" description="목록 맨 위에 보여요" checked={pinned} onChange={setPinned} />
              {/* (#538) 앱, 웹을 열 때 한 번 창으로 (D-291) */}
              <ToggleRow label="팝업으로 띄우기" description="앱, 웹을 열 때 한 번 창으로 보여요" checked={popup} onChange={setPopup} />
              {pushedAt ? (
                <ToggleRow label="푸시로도 알리기" description={`푸시 보냄: ${adminDateTime(pushedAt)}`} checked disabled onChange={() => {}} />
              ) : (
                <ToggleRow
                  label="푸시로도 알리기"
                  description={published ? "저장할 때 모든 사용자에게 한 번 보내요" : "게시할 때 모든 사용자에게 한 번 보내요"}
                  checked={push}
                  onChange={setPush}
                />
              )}
            </RowGroup>
            <div>
              <div className="mb-1.5 flex items-center">
                <label htmlFor="notice-body" className="text-[12px] font-medium leading-4 text-ink-2">
                  본문
                </label>
                <button
                  type="button"
                  onClick={() => setPreview((v) => !v)}
                  className="hit ml-auto rounded-sm px-1 text-[12px] font-semibold text-ink-2 hover:text-ink"
                >
                  {preview ? "고치기" : "미리 보기"}
                </button>
              </div>
              {preview ? (
                <div className="min-h-[240px] rounded-sm bg-surface px-3.5 py-3">
                  <NoticeBody body={body} />
                </div>
              ) : (
                <textarea
                  id="notice-body"
                  aria-describedby="notice-body-hint"
                  className={`${inputClass} min-h-[240px] resize-y`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              )}
              <p id="notice-body-hint" className="t-sub mt-1.5">
                빈 줄로 문단을 나누고, https 로 시작하는 주소는 링크가 돼요
              </p>
            </div>
            {error && <InlineError>{error}</InlineError>}
            <div className="flex flex-wrap gap-2 pt-1">
              {published ? (
                <>
                  <Button variant="secondary" disabled={busy} onClick={() => void save(false, false)}>
                    게시 취소
                  </Button>
                  <Button className="ml-auto" loading={update.isPending} disabled={busy} onClick={() => requestSave(true)}>
                    {push && !pushedAt ? "저장하고 푸시 보내기" : "저장"}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" disabled={busy} onClick={() => void save(false, false)}>
                    초안 저장
                  </Button>
                  <Button className="ml-auto" loading={create.isPending || update.isPending} disabled={busy} onClick={() => requestSave(true)}>
                    {push && !pushedAt ? "게시하고 푸시 보내기" : "게시"}
                  </Button>
                </>
              )}
            </div>
          </div>
          {notice && (
            <div className="mt-4 text-center">
              <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
                공지 삭제
              </Button>
            </div>
          )}
        </div>
        {showResults && notice && <AdminNoticeResults id={notice.id} />}
      </div>
      <ConfirmDialog
        open={confirmPush}
        title="모든 사용자에게 푸시를 보낼까요?"
        body="공지 알림을 켠 사용자의 모든 기기로 한 번 가요. 보낸 뒤에는 거둘 수 없고 다시 보낼 수도 없어요"
        confirmLabel={published ? "저장하고 보내기" : "게시하고 보내기"}
        loading={create.isPending || update.isPending}
        onConfirm={() => void save(true, true)}
        onCancel={() => setConfirmPush(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="이 공지를 삭제할까요?"
        body="삭제하면 되돌릴 수 없어요. 내리기만 하려면 게시 취소를 눌러 주세요"
        confirmLabel="삭제"
        danger
        loading={remove.isPending}
        onConfirm={() => void onDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
