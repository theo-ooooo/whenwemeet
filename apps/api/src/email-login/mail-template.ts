/**
 * (#245) 로그인 메일 문구 (이메일-로그인.md 5장). 순수 함수, 스냅샷 테스트.
 * 표 기반 한 단 폭 480, 바탕 흰색, 시스템 글꼴, 외부 이미지 없음. 수신 거부 링크 없음(거래성 메일)
 */

export const LOGIN_MAIL_SUBJECT = '[언제볼까] 로그인 링크와 코드';

export interface LoginMailInput {
  /** `${WEB_ORIGIN}/auth/email?token=<43자>` */
  link: string;
  /** 6자리 숫자 */
  code: string;
}

export interface LoginMail {
  subject: string;
  html: string;
  text: string;
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const BUTTON = '#C8432D';
const INK = '#1F1A17';
const SOFT = '#6B625C';
const MUTE = '#9A918B';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** (#198) 로그인 방법 연결 메일 제목 (D-257). 링크 없이 코드만 */
export const LINK_MAIL_SUBJECT = '[언제볼까] 로그인 방법 연결 코드';

/**
 * (#198) 로그인한 사용자가 내 정보에서 이메일을 연결할 때 보내는 메일. 코드만 싣는다(누르면 로그인되는 링크 없음).
 * 같은 틀, 같은 색
 */
export function renderLinkMail({ code }: { code: string }): LoginMail {
  const digits = escapeHtml(code);
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(LINK_MAIL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#FFFFFF;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">연결 코드 ${digits} (15분 동안 쓸 수 있어요)</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;font-family:${FONT};color:${INK};">
<tr><td style="font-size:20px;font-weight:700;padding:0 0 24px;">언제볼까</td></tr>
<tr><td style="font-size:16px;line-height:1.6;padding:0 0 12px;">이 이메일을 언제볼까 로그인 방법으로 연결하려면 아래 코드를 입력하세요.</td></tr>
<tr><td align="center" style="padding:0 0 32px;font-size:32px;font-weight:700;letter-spacing:0.3em;font-variant-numeric:tabular-nums;font-family:ui-monospace, Menlo, Consolas, monospace;">${digits}</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:${SOFT};padding:0 0 8px;">15분 안에 사용해 주세요. 코드는 한 번만 쓸 수 있어요.</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:${SOFT};padding:0 0 32px;">요청하지 않았다면 이 메일을 무시하세요. 코드를 다른 사람에게 알려 주지 마세요.</td></tr>
<tr><td style="font-size:12px;color:${MUTE};">whenwemeet.day</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
  const text = [
    '언제볼까',
    '',
    '이 이메일을 언제볼까 로그인 방법으로 연결하려면 아래 코드를 입력하세요.',
    code,
    '',
    '15분 안에 사용해 주세요. 코드는 한 번만 쓸 수 있어요.',
    '요청하지 않았다면 이 메일을 무시하세요. 코드를 다른 사람에게 알려 주지 마세요.',
    '',
    'whenwemeet.day',
    '',
  ].join('\n');
  return { subject: LINK_MAIL_SUBJECT, html, text };
}

export function renderLoginMail({ link, code }: LoginMailInput): LoginMail {
  const href = escapeHtml(link);
  const digits = escapeHtml(code);
  const preheader = `로그인 코드 ${digits} (15분 동안 쓸 수 있어요)`;

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(LOGIN_MAIL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#FFFFFF;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;font-family:${FONT};color:${INK};">
<tr><td style="font-size:20px;font-weight:700;padding:0 0 24px;">언제볼까</td></tr>
<tr><td style="font-size:16px;line-height:1.6;padding:0 0 16px;">아래 버튼을 누르면 바로 로그인돼요.</td></tr>
<tr><td align="center" style="padding:0 0 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${BUTTON}" style="border-radius:12px;">
<a href="${href}" target="_blank" style="display:inline-block;padding:0 32px;line-height:48px;height:48px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:12px;font-family:${FONT};">언제볼까 시작하기</a>
</td>
</tr></table>
</td></tr>
<tr><td style="font-size:16px;line-height:1.6;padding:0 0 12px;">앱이나 다른 기기에서는 이 코드를 입력하세요.</td></tr>
<tr><td align="center" style="padding:0 0 32px;font-size:32px;font-weight:700;letter-spacing:0.3em;font-variant-numeric:tabular-nums;font-family:ui-monospace, Menlo, Consolas, monospace;">${digits}</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:${SOFT};padding:0 0 8px;">15분 안에 사용해 주세요. 링크와 코드는 한 번만 쓸 수 있어요.</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:${SOFT};padding:0 0 32px;">요청하지 않았다면 이 메일을 무시하세요. 계정에는 아무 일도 일어나지 않아요.</td></tr>
<tr><td style="font-size:12px;color:${MUTE};">whenwemeet.day</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

  const text = [
    '언제볼까',
    '',
    '아래 링크를 열면 바로 로그인돼요.',
    link,
    '',
    '앱이나 다른 기기에서는 이 코드를 입력하세요.',
    code,
    '',
    '15분 안에 사용해 주세요. 링크와 코드는 한 번만 쓸 수 있어요.',
    '요청하지 않았다면 이 메일을 무시하세요. 계정에는 아무 일도 일어나지 않아요.',
    '',
    'whenwemeet.day',
    '',
  ].join('\n');

  return { subject: LOGIN_MAIL_SUBJECT, html, text };
}
