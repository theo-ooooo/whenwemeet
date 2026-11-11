"use client";
// (#245) 링크 확인 화면의 [로그인 계속하기] (이메일-로그인.md 6-4, D-113). 일반 form POST 라 JS 가 없어도 동작한다.
// 자동 제출하지 않는다. 누른 뒤에는 두 번 보내지 않게 버튼을 막는다
import { useState } from "react";
import { Button } from "./ui";

export function LinkConfirmForm({ token }: { token: string }) {
  const [going, setGoing] = useState(false);
  return (
    <form
      method="post"
      action="/auth/email/link"
      onSubmit={(e) => {
        if (going) e.preventDefault();
        else setGoing(true);
      }}
    >
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="xl" full loading={going}>
        로그인 계속하기
      </Button>
    </form>
  );
}
