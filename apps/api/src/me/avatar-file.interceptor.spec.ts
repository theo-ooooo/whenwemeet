import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { of } from 'rxjs';
import { AvatarFileInterceptor } from './avatar-file.interceptor.js';

describe('AvatarFileInterceptor', () => {
  const base = Object.getPrototypeOf(AvatarFileInterceptor.prototype) as { intercept: (...args: unknown[]) => Promise<unknown> };
  const interceptor = new AvatarFileInterceptor(undefined as never);
  const next = { handle: () => of('ok') };

  afterEach(() => vi.restoreAllMocks());

  it('multer 4xx (413 크기 초과, 400 필드 이름) 는 한국어 400 VALIDATION_FAILED 로', async () => {
    for (const error of [new PayloadTooLargeException('File too large'), new BadRequestException('Unexpected field')]) {
      vi.spyOn(base, 'intercept').mockRejectedValueOnce(error);
      await expect(interceptor.intercept({} as never, next)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'jpg, png, webp 10MB 까지 올릴 수 있어요',
      });
    }
  });

  it('그 외 오류는 그대로, 성공은 그대로 통과', async () => {
    const boom = new Error('disk');
    vi.spyOn(base, 'intercept').mockRejectedValueOnce(boom);
    await expect(interceptor.intercept({} as never, next)).rejects.toBe(boom);
    const stream = of('done');
    vi.spyOn(base, 'intercept').mockResolvedValueOnce(stream);
    expect(await interceptor.intercept({} as never, next)).toBe(stream);
  });
});
