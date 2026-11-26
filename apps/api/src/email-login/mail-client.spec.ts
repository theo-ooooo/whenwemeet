import { urlOf } from '../testing/fetch-url.js';
import { DEFAULT_EMAIL_FROM, EmailLoginConfig } from './email-login.config.js';
import { fakeConfig } from '../testing/fake-config.js';
import {
  ConsoleMailClient,
  createMailClient,
  type FetchFn,
  MailSendError,
  RESEND_TIMEOUT_MS,
  ResendMailClient,
} from './mail-client.js';

const message = {
  to: 'a@b.co',
  subject: 's',
  html: '<p>h</p>',
  text: 't',
  idempotencyKey: 'email-login-7',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('ResendMailClient (D-117)', () => {
  it('POST /emails, 헤더(Bearer, Idempotency-Key), 본문 모양, 10초 제한', async () => {
    const fetchFn = vi.fn(async () => json(200, { id: 'msg_123' }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const client = new ResendMailClient(
      're_key',
      DEFAULT_EMAIL_FROM,
      'https://api.resend.com',
      fetchFn as FetchFn,
    );
    expect(await client.send(message)).toEqual({
      status: 'SENT',
      id: 'msg_123',
    });
    const [input, init] = fetchFn.mock.calls[0] as unknown as [
      RequestInfo,
      RequestInit,
    ];
    expect(urlOf(input)).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer re_key',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'email-login-7',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: DEFAULT_EMAIL_FROM,
      to: ['a@b.co'],
      subject: 's',
      html: '<p>h</p>',
      text: 't',
      tags: [{ name: 'type', value: 'login' }],
    });
    expect(timeout).toHaveBeenCalledWith(RESEND_TIMEOUT_MS);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('2xx 인데 id 가 없으면 id null', async () => {
    const client = new ResendMailClient('k', 'f', 'u', (async () =>
      json(200, {})) as FetchFn);
    expect(await client.send(message)).toEqual({ status: 'SENT', id: null });
  });

  it('4xx, 5xx 는 상태와 오류 name, 시간 초과와 연결 실패도 MailSendError. 재시도 없음', async () => {
    const send = async (fetchFn: () => Promise<Response>) => {
      const spy = vi.fn(fetchFn);
      const error = await new ResendMailClient('k', 'f', 'u', spy as FetchFn)
        .send(message)
        .catch((e: unknown) => e);
      expect(spy).toHaveBeenCalledTimes(1);
      return error;
    };
    expect(
      await send(async () =>
        json(422, { name: 'validation_error', message: 'x' }),
      ),
    ).toMatchObject({ httpStatus: 422, errorName: 'validation_error' });
    expect(await send(async () => json(500, {}))).toMatchObject({
      httpStatus: 500,
      errorName: 'unknown',
    });
    expect(
      await send(async () => new Response('oops', { status: 503 })),
    ).toMatchObject({ httpStatus: 503, errorName: 'unknown' });
    const timeout = await send(async () =>
      Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
    );
    expect(timeout).toBeInstanceOf(MailSendError);
    expect(timeout).toMatchObject({ httpStatus: null, errorName: 'TIMEOUT' });
    expect(
      await send(async () => Promise.reject(new TypeError('fetch failed'))),
    ).toMatchObject({ httpStatus: null, errorName: 'CONNECTION' });
  });
});

describe('ConsoleMailClient, createMailClient', () => {
  const secret = 'unit-secret-0123456789abcdef0123456789';

  it('키가 없으면 콘솔(보내지 않음, SKIPPED). 운영이면 본문을 찍지 않는다', async () => {
    const dev = createMailClient(
      new EmailLoginConfig(fakeConfig({ JWT_SECRET: secret })),
    );
    expect(dev).toBeInstanceOf(ConsoleMailClient);
    const log = vi
      .spyOn(
        (dev as unknown as { logger: { log: (m: string) => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    expect(await dev.send(message)).toEqual({ status: 'SKIPPED' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('t'));

    const prod = new ConsoleMailClient(true);
    const prodLog = vi.spyOn(
      (prod as unknown as { logger: { log: (m: string) => void } }).logger,
      'log',
    );
    expect(await prod.send(message)).toEqual({ status: 'SKIPPED' });
    expect(prodLog).not.toHaveBeenCalled();
  });

  it('키가 있으면 Resend', () => {
    expect(
      createMailClient(
        new EmailLoginConfig(
          fakeConfig({ JWT_SECRET: secret, RESEND_API_KEY: 're_x' }),
        ),
      ),
    ).toBeInstanceOf(ResendMailClient);
  });
});
