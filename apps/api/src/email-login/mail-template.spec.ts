import { LOGIN_MAIL_SUBJECT, renderLoginMail } from './mail-template.js';

const LINK = 'https://whenwemeet.day/auth/email?token=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

describe('로그인 메일 문구 (5장)', () => {
  const mail = renderLoginMail({ link: LINK, code: '012345' });

  it('제목, 미리보기 글, 버튼, 코드, 안내, 한국어', () => {
    expect(mail.subject).toBe(LOGIN_MAIL_SUBJECT);
    expect(mail.subject).toBe('[언제볼까] 로그인 링크와 코드');
    expect(mail.html).toContain('<html lang="ko">');
    expect(mail.html).toContain('로그인 코드 012345 (15분 동안 쓸 수 있어요)');
    expect(mail.html).toContain(`href="${LINK}"`);
    expect(mail.html).toContain('언제볼까 시작하기');
    expect(mail.html).toContain('#C8432D');
    expect(mail.html).toContain('15분 안에 사용해 주세요. 링크와 코드는 한 번만 쓸 수 있어요.');
    expect(mail.html).toContain('요청하지 않았다면 이 메일을 무시하세요. 계정에는 아무 일도 일어나지 않아요.');
    expect(mail.html).not.toMatch(/<img/i);
  });

  it('text 판: 같은 문장 + 링크 원문 + 코드', () => {
    expect(mail.text).toContain(LINK);
    expect(mail.text).toContain('\n012345\n');
    expect(mail.text).toContain('15분 안에 사용해 주세요.');
    expect(mail.text).toContain('요청하지 않았다면 이 메일을 무시하세요.');
  });

  it('링크의 특수문자는 HTML 로 이스케이프', () => {
    expect(renderLoginMail({ link: 'https://x/?a=1&b="2"', code: '000000' }).html).toContain('href="https://x/?a=1&amp;b=&quot;2&quot;"');
  });

  it('스냅샷', () => {
    expect(mail.html).toMatchSnapshot();
    expect(mail.text).toMatchSnapshot();
  });
});
