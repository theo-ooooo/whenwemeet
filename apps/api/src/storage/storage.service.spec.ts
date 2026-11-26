import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service.js';

const R2 = {
  R2_ACCOUNT_ID: 'acc123',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  R2_BUCKET: 'whenwemeet-dev',
  R2_PUBLIC_BASE_URL: 'https://pub-x.r2.dev/',
};

function storageWith(env: Record<string, string>): StorageService {
  return new StorageService(new ConfigService(env));
}

describe('StorageService', () => {
  const send = vi.spyOn(S3Client.prototype, 'send');

  beforeEach(() => {
    send.mockReset().mockResolvedValue({} as never);
  });

  it('R2 변수가 하나라도 비면 미설정: 업로드 관련 호출은 503 STORAGE_NOT_CONFIGURED', async () => {
    const storage = storageWith({ ...R2, R2_SECRET_ACCESS_KEY: '' });
    expect(storage.isConfigured()).toBe(false);
    expect(() => storage.assertConfigured()).toThrow(
      expect.objectContaining({ code: 'STORAGE_NOT_CONFIGURED' }),
    );
    expect(() => storage.bucket).toThrow(
      expect.objectContaining({ code: 'STORAGE_NOT_CONFIGURED' }),
    );
    await expect(
      storage.put('k', Buffer.from('x'), 'image/webp'),
    ).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('공개 주소(R2_PUBLIC_BASE_URL) 가 비어도 미설정: 올린 사진의 URL 을 돌려줄 수 없으므로', () => {
    expect(storageWith({ ...R2, R2_PUBLIC_BASE_URL: '' }).isConfigured()).toBe(
      false,
    );
  });

  it('설정되면 R2 엔드포인트(region auto) 로 put/delete. 공개 URL 은 만들지 않는다 (FileUrlBuilder, D-56)', async () => {
    const storage = storageWith(R2);
    expect(storage.isConfigured()).toBe(true);
    expect(storage.provider).toBe('R2');
    expect(storage.bucket).toBe('whenwemeet-dev');
    expect(storage).not.toHaveProperty('publicUrl');

    await storage.put('avatars/1/a.webp', Buffer.from('img'), 'image/webp');
    const put = send.mock.calls[0][0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({
      Bucket: 'whenwemeet-dev',
      Key: 'avatars/1/a.webp',
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    });

    await storage.delete('avatars/1/a.webp');
    await storage.delete('avatars/1/b.webp', 'whenwemeet');
    const [del1, del2] = [
      send.mock.calls[1][0],
      send.mock.calls[2][0],
    ] as DeleteObjectCommand[];
    expect(del1).toBeInstanceOf(DeleteObjectCommand);
    expect(del1.input).toEqual({
      Bucket: 'whenwemeet-dev',
      Key: 'avatars/1/a.webp',
    });
    expect(del2.input).toEqual({
      Bucket: 'whenwemeet',
      Key: 'avatars/1/b.webp',
    });

    const client = (storage as unknown as { client: S3Client }).client;
    expect(await client.config.region()).toBe('auto');
    const endpoint = await client.config.endpoint!();
    expect(endpoint.hostname).toBe('acc123.r2.cloudflarestorage.com');
  });
});
