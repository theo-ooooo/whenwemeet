// (#515) 공지 본문. 일반 텍스트를 문단과 https 링크로만 그린다 (lib/notice.ts). HTML 로 해석하지 않는다
import { noticeParagraphs } from "@/lib/notice";

export function NoticeBody({ body, className = "" }: { body: string; className?: string }) {
  return (
    <div className={`space-y-3 text-[15px] leading-6 text-soft ${className}`}>
      {noticeParagraphs(body).map((segments, i) => (
        <p key={i} className="whitespace-pre-line break-words">
          {segments.map((s, j) =>
            s.type === "link" ? (
              <a key={j} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-semibold text-ink underline underline-offset-2">
                {s.href}
              </a>
            ) : (
              <span key={j}>{s.text}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
