import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { ApiException } from '../common/errors.js';
import { FileUrlBuilder } from '../files/file-url.builder.js';
import { FilesRepository } from '../files/files.repository.js';
import { sampleImage } from '../testing/images.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { AVATAR_IMPORT_TIMEOUT_MS, AvatarsService } from './avatars.service.js';

function fakeStorage(configured = true) {
  return {
    provider: 'R2' as const,
    bucket: 'whenwemeet-dev',
    isConfigured: vi.fn(() => configured),
    assertConfigured: vi.fn(() => {
      if (!configured) throw new ApiException('STORAGE_NOT_CONFIGURED');
    }),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
}

/** 도메인은 환경 변수에만 있다 (D-56). 끝 슬래시는 빌더가 정리 */
const urls = new FileUrlBuilder(
  new ConfigService({ R2_PUBLIC_BASE_URL: 'https://pub.example/' }),
);

const PREVIOUS = {
  id: 9,
  provider: 'R2' as const,
  bucket: 'whenwemeet-dev',
  key: 'avatars/1/old.webp',
};

describe('AvatarsService', () => {
  let files: RepositoryMock<FilesRepository>;
  let storage: ReturnType<typeof fakeStorage>;
  let service: AvatarsService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    files = mockRepository(FilesRepository);
    storage = fakeStorage();
    service = new AvatarsService(files as never, storage as never, urls);
    files.replaceAvatarTx.mockImplementation(async () => ({ previous: null }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('upload', () => {
    it('webp 512 로 바꿔 avatars/<userId>/<ulid>.webp 에 올리고 File 을 교체, 이전 객체는 삭제', async () => {
      files.replaceAvatarTx.mockImplementation(async () => ({
        previous: PREVIOUS,
      }));
      const jpeg = await sampleImage('jpeg');
      const result = await service.upload(1, {
        buffer: jpeg,
        size: jpeg.length,
      });

      const [key, body, contentType] = storage.put.mock.calls[0] as unknown as [
        string,
        Buffer,
        string,
      ];
      expect(key).toMatch(/^avatars\/1\/[0-9A-HJKMNP-TV-Z]{26}\.webp$/);
      expect(contentType).toBe('image/webp');
      expect(await sharp(body).metadata()).toMatchObject({
        format: 'webp',
        width: 512,
        height: 512,
      });
      expect(files.replaceAvatarTx).toHaveBeenCalledWith(1, {
        provider: 'R2',
        bucket: 'whenwemeet-dev',
        key,
        mimeType: 'image/webp',
        size: body.length,
        width: 512,
        height: 512,
        kind: 'AVATAR',
        sourceUrl: null,
      });
      expect(storage.delete).toHaveBeenCalledWith(
        'avatars/1/old.webp',
        'whenwemeet-dev',
      );
      // DB 에는 URL(도메인) 을 넘기지 않고, 응답 URL 은 빌더가 base + key 로 만든다
      expect(files.replaceAvatarTx.mock.calls[0][1]).not.toHaveProperty(
        'publicUrl',
      );
      expect(result).toEqual({ profileImageUrl: `https://pub.example/${key}` });
    });

    it('저장소 미설정이면 503, 파일을 보지도 않는다', async () => {
      storage = fakeStorage(false);
      service = new AvatarsService(files as never, storage as never, urls);
      await expect(service.upload(1, undefined)).rejects.toMatchObject({
        code: 'STORAGE_NOT_CONFIGURED',
      });
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('파일 없음 / 형식 오류는 400, 저장소와 DB 는 건드리지 않는다', async () => {
      await expect(service.upload(1, undefined)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message: '사진 파일을 골라 주세요',
      });
      await expect(
        service.upload(1, { buffer: Buffer.from('gif?'), size: 4 }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(storage.put).not.toHaveBeenCalled();
      expect(files.replaceAvatarTx).not.toHaveBeenCalled();
    });

    it('File 행 생성이 실패하면 방금 올린 객체를 지우고 오류를 그대로 던진다', async () => {
      files.replaceAvatarTx.mockRejectedValue(new Error('db down'));
      const png = await sampleImage('png');
      await expect(
        service.upload(1, { buffer: png, size: png.length }),
      ).rejects.toThrow('db down');
      const [key] = storage.put.mock.calls[0] as unknown as [string];
      expect(storage.delete).toHaveBeenCalledWith(key, 'whenwemeet-dev');
    });

    it('이전 객체 삭제가 실패해도 업로드는 성공 (로그만)', async () => {
      files.replaceAvatarTx.mockImplementation(async () => ({
        previous: PREVIOUS,
      }));
      storage.delete.mockRejectedValue(new Error('r2 down'));
      const webp = await sampleImage('webp');
      expect(
        (await service.upload(1, { buffer: webp, size: webp.length }))
          .profileImageUrl,
      ).toMatch(/^https:\/\/pub\.example\/avatars\/1\//);
    });
  });

  describe('remove', () => {
    it('File 행을 지우고 객체도 삭제', async () => {
      files.clearAvatarTx.mockResolvedValue(PREVIOUS);
      expect(await service.remove(1)).toEqual({ profileImageUrl: null });
      expect(storage.delete).toHaveBeenCalledWith(
        'avatars/1/old.webp',
        'whenwemeet-dev',
      );
    });

    it('사진이 없으면 아무것도 지우지 않고 성공', async () => {
      files.clearAvatarTx.mockResolvedValue(null);
      expect(await service.remove(1)).toEqual({ profileImageUrl: null });
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('저장소 미설정이거나 R2 가 아닌 파일이면 행만 지우고 객체는 건너뛴다', async () => {
      storage = fakeStorage(false);
      service = new AvatarsService(files as never, storage as never, urls);
      files.clearAvatarTx.mockResolvedValue(PREVIOUS);
      expect(await service.remove(1)).toEqual({ profileImageUrl: null });
      expect(storage.delete).not.toHaveBeenCalled();

      storage = fakeStorage(true);
      service = new AvatarsService(files as never, storage as never, urls);
      files.clearAvatarTx.mockResolvedValue({ ...PREVIOUS, provider: 'LOCAL' });
      await service.remove(1);
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('importFromUrl', () => {
    it('소셜 사진을 받아 같은 파이프라인으로 저장하고 sourceUrl 을 남긴다 (타임아웃 5초)', async () => {
      const jpeg = await sampleImage('jpeg');
      const fetchMock = vi.fn<typeof fetch>(
        async () =>
          new Response(new Uint8Array(jpeg), {
            status: 200,
            headers: { 'content-length': String(jpeg.length) },
          }),
      );
      globalThis.fetch = fetchMock;
      const url = await service.importFromUrl(
        2,
        'https://k.kakaocdn.net/p.jpg',
      );
      expect(url).toMatch(/^https:\/\/pub\.example\/avatars\/2\/.+\.webp$/);
      expect(fetchMock.mock.calls[0][0]).toBe('https://k.kakaocdn.net/p.jpg');
      expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
      expect(AVATAR_IMPORT_TIMEOUT_MS).toBe(5000);
      expect(files.replaceAvatarTx.mock.calls[0][1]).toMatchObject({
        kind: 'AVATAR',
        sourceUrl: 'https://k.kakaocdn.net/p.jpg',
      });
    });

    it('사진이 없거나 저장소 미설정이면 fetch 하지 않고 null', async () => {
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;
      expect(await service.importFromUrl(2, null)).toBeNull();
      storage = fakeStorage(false);
      service = new AvatarsService(files as never, storage as never, urls);
      expect(await service.importFromUrl(2, 'https://k/p.jpg')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('HTTP 오류, 크기 초과 선언, 이미지 아님, 네트워크 오류는 전부 null (가입은 계속)', async () => {
      const cases: Array<() => Promise<Response>> = [
        async () => new Response('x', { status: 404 }),
        async () =>
          new Response('x', {
            status: 200,
            headers: { 'content-length': String(11 * 1024 * 1024) },
          }),
        async () => new Response('<html>', { status: 200 }),
        async () => {
          throw new Error('timeout');
        },
        async () => {
          throw 'weird';
        },
      ];
      for (const impl of cases) {
        globalThis.fetch = vi.fn<typeof fetch>(impl);
        expect(await service.importFromUrl(2, 'https://k/p.jpg')).toBeNull();
      }
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  it('purgeObjects 는 소유 파일 객체를 전부 지우고, 하나가 실패해도 계속한다', async () => {
    files.listByOwner.mockResolvedValue([
      PREVIOUS,
      { ...PREVIOUS, id: 10, key: 'avatars/1/b.webp' },
    ]);
    storage.delete.mockRejectedValueOnce('first fails');
    await service.purgeObjects(1);
    expect(files.listByOwner).toHaveBeenCalledWith(1);
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(storage.delete).toHaveBeenLastCalledWith(
      'avatars/1/b.webp',
      'whenwemeet-dev',
    );
  });
});
