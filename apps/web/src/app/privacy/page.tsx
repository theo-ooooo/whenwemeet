import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export const metadata: Metadata = { title: "개인정보처리방침" };

export default function PrivacyPage() {
  return (
    <LegalPage title="개인정보처리방침" updated="2026년 11월 11일">
      <h2>1. 수집하는 항목</h2>
      <p>카카오 또는 Apple 로 로그인할 때 아래 항목만 받습니다. 이메일과 전화번호는 요청하지 않습니다.</p>
      <h3>카카오 로그인</h3>
      <ul>
        <li>카카오 회원번호: 계정을 구분하는 데 씁니다</li>
        <li>닉네임: 팀 안에서 이름으로 보입니다</li>
        <li>프로필 사진: 팀 멤버 목록과 내 정보에 보입니다</li>
      </ul>
      <h3>Apple 로그인</h3>
      <ul>
        <li>Apple 사용자 식별자: 계정을 구분하는 데 씁니다</li>
        <li>이름: Apple 이 첫 로그인 때만 알려 주며, 닉네임의 처음 값으로만 씁니다</li>
        <li>연결 해제용 토큰: 탈퇴할 때 Apple 에 연결 해제를 요청하는 데만 씁니다</li>
      </ul>
      <h3>앱 알림을 허용한 경우</h3>
      <ul>
        <li>기기 푸시 토큰: 그 기기로 알림을 보내는 데만 씁니다</li>
        <li>기기 종류(iOS 또는 Android)와 앱 버전: 알림 형식을 맞추고 문제를 찾는 데 씁니다</li>
      </ul>
      <p>서비스를 쓰면서 직접 입력한 팀 이름, 일정, 기념일, 표시 이름과 색, 알림 설정도 저장합니다.</p>
      <h2>2. 이용 목적</h2>
      <p>
        로그인, 팀 안에서 멤버를 구분해 보여주기, 일정과 빈 시간 계산, 일정과 팀 소식 알림 발송에만 씁니다. 광고성
        알림은 보내지 않으며, 광고나 분석 목적의 제3자 제공은 하지 않습니다.
      </p>
      <h2>3. 보유 기간</h2>
      <p>
        회원 탈퇴 시 즉시 삭제합니다. 개인 달력과 그 일정은 함께 삭제되고, 다른 팀에 남긴 일정은 작성자
        정보가 지워진 채 &quot;탈퇴한 멤버&quot; 로 남습니다. 탈퇴 시 카카오 계정 연결을 해제하고, Apple 로 가입했다면
        Apple 에 토큰 폐기(revoke)를 요청해 연결을 끊습니다. 자세한 삭제 범위는{" "}
        <Link href="/support#delete-account" className="underline underline-offset-2">
          계정 삭제 안내
        </Link>
        에 있습니다.
      </p>
      <p>
        앱 알림용 기기 정보는 로그아웃하면 그 기기 것을, 탈퇴하면 전부 즉시 삭제합니다. 앱을 지워 알림이 전달되지 않는
        기기 정보도 확인되는 대로 삭제합니다. 알림 발송 기록은 30일 뒤 삭제합니다.
      </p>
      <h2>4. 처리 위탁</h2>
      <p>
        서비스 운영을 위해 호스팅(서버, 데이터베이스)과 프로필 사진 저장(Cloudflare R2)을 외부 클라우드 사업자에 위탁합니다. 위탁받은
        사업자는 보관과 전송 외의 목적으로 정보를 쓰지 않습니다.
      </p>
      <p>앱 알림을 허용한 경우, 알림 발송을 아래 사업자에 위탁합니다.</p>
      <ul>
        <li>Expo(650 Industries, Inc., 미국): 푸시 알림 중계</li>
        <li>Apple Inc.(미국): iPhone 알림 전달(APNs)</li>
        <li>Google LLC(미국): Android 알림 전달(Firebase Cloud Messaging)</li>
      </ul>
      <p>
        국외 이전: 이전 항목은 기기 푸시 토큰과 알림 문구(일정 제목, 시각, 팀 이름, 멤버 표시 이름)이고, 목적은 알림
        전달입니다. 알림을 보낼 때마다 네트워크로 전송되며, 각 사업자는 전달에 필요한 기간만 보관합니다. 알림을 원하지 않으면
        내 정보 &gt; 알림 또는 기기 설정에서 끌 수 있습니다.
      </p>
      <h2>5. 쿠키</h2>
      <p>
        로그인 상태를 유지하는 세션 쿠키와 마지막으로 본 팀을 기억하는 쿠키를 씁니다. 추적이나 광고용
        쿠키는 쓰지 않습니다.
      </p>
      <h2>6. 이용자의 권리</h2>
      <p>
        웹과 앱의 내 정보 화면에서 언제든 탈퇴할 수 있습니다. 닉네임과 프로필 사진은 내 정보 화면에서 바꿀 수
        있습니다. 가입할 때 카카오 닉네임과 사진(Apple 은 이름)을 처음 값으로 가져오며, 이후 카카오나 Apple 에서
        바꿔도 덮어쓰지 않습니다. 팀별 표시 이름과 색은 팀 설정에서 바꿀 수 있습니다.
      </p>
      <h2>7. 문의</h2>
      <p>
        개인정보에 관한 문의와 삭제 요청은{" "}
        <a href={supportMailto("개인정보 문의")} className="underline underline-offset-2">
          {SUPPORT_EMAIL}
        </a>{" "}
        로 보내 주세요. 다른 문의 방법은{" "}
        <Link href="/support" className="underline underline-offset-2">
          고객 지원
        </Link>
        에 있습니다.
      </p>
    </LegalPage>
  );
}
