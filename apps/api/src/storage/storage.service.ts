import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors.js';

/**
 * R2 설정 변수 (docs/운영/cloudflare-r2.md). 하나라도 비면 저장소 미설정.
 * `R2_PUBLIC_BASE_URL` 은 여기서 쓰지 않고 FileUrlBuilder 가 읽지만, 올린 사진의 URL 을 돌려줄 수 있어야 하므로 업로드 조건에 넣는다 (D-56)
 */
export const R2_ENV_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_BASE_URL',
] as const;

/** 공개 URL 로 바로 서빙하므로 키는 매번 새로 만든다 (덮어쓰기 없음). 그래서 길게 캐시해도 된다 */
const OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Cloudflare R2 (S3 호환) 저장소 (결정기록 D-37).
 * 설정이 없어도 서버는 뜨고, 업로드가 필요한 곳만 `assertConfigured()` 로 503 STORAGE_NOT_CONFIGURED 를 돌려준다
 */
@Injectable()
export class StorageService {
  readonly provider = 'R2' as const;
  private readonly client: S3Client | null = null;
  private readonly bucketName: string | null = null;

  constructor(config: ConfigService) {
    if (!R2_ENV_KEYS.every((key) => config.get<string>(key))) return;
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.getOrThrow<string>('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
      },
    });
    this.bucketName = config.getOrThrow<string>('R2_BUCKET');
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  assertConfigured(): void {
    if (!this.isConfigured()) throw new ApiException('STORAGE_NOT_CONFIGURED');
  }

  /** 지금 쓰는 버킷. File.bucket 에 기록한다 */
  get bucket(): string {
    this.assertConfigured();
    return this.bucketName!;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: OBJECT_CACHE_CONTROL,
      }),
    );
  }

  /** 객체 삭제. 다른 버킷(이전 환경) 에 있는 파일이면 bucket 을 넘긴다. 없는 키도 성공 (S3 규약) */
  async delete(key: string, bucket: string = this.bucket): Promise<void> {
    await this.s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  private s3(): S3Client {
    this.assertConfigured();
    return this.client!;
  }
}
