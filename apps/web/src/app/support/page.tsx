import type { Metadata } from "next";
import Link from "next/link";
import { IconChevronDown } from "@/components/icons";
import { LegalPage, legalCardClass } from "@/components/LegalPage";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

// 스토어 지원 URL 과 계정 삭제 안내 URL(#delete-account). 로그인 없이 열린다 (proxy.ts matcher 에 없음, #148)
export const metadata: Metadata = {
  title: "고객 지원",
  description: "언제볼까 문의 이메일, 자주 묻는 질문, 계정 삭제 방법",
};

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "초대 링크가 안 열려요",
    a: (
      <>
        <p>
          팀에서 초대 코드를 재발급하면 이전 링크는 더 이상 쓸 수 없어요. 팀 멤버에게 새 링크를 받아 주세요.
        </p>
        <p>
          링크 대신 6자리 코드만 받아도 돼요. 로그인 후 팀 목록의 <b>초대 코드로 합류</b> 에서 입력하면 같은 달력에
          합류해요.
        </p>
      </>
    ),
  },
  {
    q: "빈 시간이 이상하게 나와요",
    a: (
      <>
        <p>
          빈 시간은 멤버마다 속한 <b>모든 팀과 개인 달력</b>의 일정을 바쁜 시간으로 보고 계산해요. 다른 팀 일정은
          내용이 보이지 않기 때문에, 이 팀 달력이 비어 있어도 빈 시간에서 빠질 수 있어요.
        </p>
        <p>
          처음에는 09:00~23:00 사이에서 2시간 이상 비는 구간만 보여줘요. 빈 시간 찾기 화면에서 기간, 시간대, 최소
          길이를 바꿔 보세요. 종일 일정은 기본으로 바쁜 시간에 넣지 않으니, 필요하면 <b>종일 일정도 바쁜 시간으로</b>
          를 켜 주세요.
        </p>
      </>
    ),
  },
  {
    q: "프로필 사진이나 닉네임은 어떻게 바꾸나요?",
    a: (
      <>
        <p>
          <b>내 정보</b> 에서 사진을 누르면 새 사진으로 바꾸거나 기본 사진으로 되돌릴 수 있어요(jpg, png, webp
          10MB 까지). 닉네임은 이름을 눌러 바꿔요.
        </p>
        <p>
          가입할 때 받은 닉네임과 사진은 처음 값으로만 쓰고, 카카오에서 바꿔도 자동으로 따라오지 않아요. 팀마다 다르게
          보일 이름과 색은 <b>팀 설정</b> 에서 바꿀 수 있어요.
        </p>
      </>
    ),
  },
  {
    q: "팀에서 나가고 싶어요",
    a: (
      <p>
        <b>팀 설정</b> 맨 아래 <b>팀 나가기</b> 를 눌러 주세요. 나가도 내가 만든 일정은 팀에 남아요. 내가 마지막
        멤버라면 팀과 모든 일정이 함께 삭제돼요.
      </p>
    ),
  },
  {
    q: "내 정보를 모두 지우고 싶어요",
    a: (
      <p>
        회원 탈퇴를 하면 돼요. 방법과 지워지는 정보는{" "}
        <a href="#delete-account" className="font-semibold text-ink underline underline-offset-2">
          계정 삭제
        </a>{" "}
        에 정리해 두었어요.
      </p>
    ),
  },
];

export default function SupportPage() {
  return (
    <LegalPage title="고객 지원" card={false}>
      <section aria-labelledby="contact" className={legalCardClass}>
        <h2 id="contact">문의</h2>
        <p>궁금한 점이나 불편한 점은 이메일로 보내 주세요.</p>
        <a
          href={supportMailto("문의")}
          className="mt-3 flex h-11 items-center justify-center rounded-md bg-btn px-5 text-[13.5px] font-bold text-on-btn hover:brightness-95"
        >
          {SUPPORT_EMAIL}
        </a>
        <p>
          개인이 운영하는 서비스라 답장까지 며칠 걸릴 수 있어요. 쓰고 있는 기기(iPhone, Android, PC)와 어떤 화면에서
          생긴 일인지 함께 적어 주시면 더 빨리 확인할 수 있어요.
        </p>
      </section>

      <section aria-labelledby="faq" className={legalCardClass}>
        <h2 id="faq">자주 묻는 질문</h2>
        <div className="mt-2">
          {FAQ.map(({ q, a }, i) => (
            <details key={q} className={`group ${i === 0 ? "" : "border-t border-line"}`}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2.5 text-[14px] font-semibold leading-5 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">{q}</span>
                <IconChevronDown size={16} className="shrink-0 text-ink-2 transition-transform group-open:rotate-180" />
              </summary>
              <div className="pb-3 [&_p:first-child]:mt-0">{a}</div>
            </details>
          ))}
        </div>
      </section>

      <section id="delete-account" aria-labelledby="delete-account-title" className={`scroll-mt-4 ${legalCardClass}`}>
        <h2 id="delete-account-title">계정 삭제 (회원 탈퇴)</h2>
        <p>앱과 웹 어디서든 같은 방법으로 탈퇴할 수 있어요. 탈퇴는 되돌릴 수 없어요.</p>
        <ol>
          <li>
            로그인한 뒤 <b>내 정보</b> 로 가요 (화면의 내 프로필 사진을 누르면 열려요)
          </li>
          <li>
            화면 맨 아래 <b>회원 탈퇴</b> 를 눌러요
          </li>
          <li>
            칸에 <b>탈퇴</b> 라고 입력하고 <b>회원 탈퇴</b> 버튼을 눌러요
          </li>
        </ol>
        <p>
          로그인할 수 없다면{" "}
          <a href={supportMailto("계정 삭제 요청")} className="font-semibold text-ink underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>{" "}
          로 가입한 방법(카카오 또는 Apple)과 닉네임을 적어 보내 주세요. 본인인지 확인한 뒤 대신 삭제해 드려요.
        </p>

        <h3>바로 삭제되는 정보</h3>
        <ul>
          <li>계정과 닉네임</li>
          <li>카카오, Apple 계정 연결. 카카오는 연결을 끊고, Apple 은 로그인 때 받은 토큰을 폐기(revoke)해요</li>
          <li>올린 프로필 사진 파일</li>
          <li>개인 달력과 그 안의 일정, 기념일</li>
          <li>팀 멤버 자격과 팀마다 정한 표시 이름, 색</li>
          <li>나 혼자 남아 있던 팀은 팀과 그 일정 전체</li>
        </ul>

        <h3>남는 정보</h3>
        <ul>
          <li>
            다른 멤버가 있는 팀에 내가 만든 일정과 기념일은 팀의 것이라 남아요. 만든 사람은 &quot;탈퇴한 멤버&quot; 로
            표시되고, 내 계정과는 더 이상 연결되지 않아요
          </li>
          <li>그 팀의 새 소식에 남은 변경 기록도 &quot;탈퇴한 멤버&quot; 로 표시돼요</li>
        </ul>
        <p>팀에 남기고 싶지 않은 일정은 탈퇴하기 전에 직접 지워 주세요.</p>
        <p>
          카카오나 Apple 연결을 끊는 데 실패하면 아무것도 지우지 않고 탈퇴를 멈춰요. 잠시 후 다시 시도해 주세요.
        </p>
      </section>

      <p className="t-sub px-1 pt-2">
        개인정보를 어떻게 다루는지는{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          개인정보처리방침
        </Link>
        에 있어요.
      </p>
    </LegalPage>
  );
}
