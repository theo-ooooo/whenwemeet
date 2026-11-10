import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { FilesRepository, StoredObjectRef } from '../files/files.repository.js';
import { StorageService } from '../storage/storage.service.js';
import { AVATAR_MAX_BYTES, avatarInvalid, toAvatarWebp } from './avatar-image.js';

/** 가입 시 소셜 프로필 사진을 받아 올 때 기다리는 최대 시간 */
export const AVATAR_IMPORT_TIMEOUT_MS = 5_000;

/** multer 가 넘기는 업로드 파일 중 쓰는 부분 */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/**
 * 프로필 사진 (결정기록 D-37, D-38). 검증/변환 → R2 put → File 행 + User.avatarFileId 교체 → 이전 객체 삭제.
 * 객체 삭제 실패는 로그만 남긴다 (고아 객체는 bucket/key 로 나중에 청소 가능)
 */
@Injectable()
export class AvatarsService {
  private readonly logger = new Logger(AvatarsService.name);

  constructor(
    private readonly files: FilesRepository,
    private readonly storage: StorageService,
  ) {}

  /** POST /me/avatar. 저장소 미설정이면 503, 파일이 없거나 형식/크기 오류면 400 */
  async upload(userId: number, file: UploadedImage | undefined): Promise<{ profileImageUrl: string }> {
    this.storage.assertConfigured();
    if (!file) throw avatarInvalid('사진 파일을 골라 주세요');
    return { profileImageUrl: await this.store(userId, file.buffer, null) };
  }

  /** DELETE /me/avatar. 사진이 없어도 성공 (멱등). 저장소가 없어도 행은 지운다 */
  async remove(userId: number): Promise<{ profileImageUrl: null }> {
    const previous = await this.files.clearAvatarTx(userId);
    if (previous) await this.deleteObjectQuietly(previous);
    return { profileImageUrl: null };
  }

  /**
   * 가입 직후 소셜 프로필 사진을 R2 로 복사 (D-37). 어떤 실패든 로그만 남기고 null — 가입은 계속된다.
   * 저장소 미설정이거나 사진이 없으면 아무것도 하지 않는다
   */
  async importFromUrl(userId: number, sourceUrl: string | null): Promise<string | null> {
    if (!sourceUrl || !this.storage.isConfigured()) return null;
    try {
      const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(AVATAR_IMPORT_TIMEOUT_MS), redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > AVATAR_MAX_BYTES) throw new Error(`크기 초과 ${declared}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      return await this.store(userId, buffer, sourceUrl);
    } catch (error) {
      this.logger.warn(`소셜 프로필 사진 복사 실패 (user ${userId}): ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /** 탈퇴 전에 이 사용자의 객체를 전부 지운다. 행은 탈퇴 트랜잭션이 지운다 */
  async purgeObjects(userId: number): Promise<void> {
    for (const file of await this.files.listByOwner(userId)) await this.deleteObjectQuietly(file);
  }

  private async store(userId: number, source: Buffer, sourceUrl: string | null): Promise<string> {
    const image = await toAvatarWebp(source);
    const key = `avatars/${userId}/${ulid()}.webp`;
    await this.storage.put(key, image.buffer, image.mimeType);
    let result: Awaited<ReturnType<FilesRepository['replaceAvatarTx']>>;
    try {
      result = await this.files.replaceAvatarTx(userId, {
        provider: this.storage.provider,
        bucket: this.storage.bucket,
        key,
        publicUrl: this.storage.publicUrl(key),
        mimeType: image.mimeType,
        size: image.buffer.length,
        width: image.width,
        height: image.height,
        kind: 'AVATAR',
        sourceUrl: sourceUrl?.slice(0, 500) ?? null,
      });
    } catch (error) {
      // 행을 못 만들었으면 방금 올린 객체는 아무도 가리키지 않는다
      await this.deleteObjectQuietly({ provider: this.storage.provider, bucket: this.storage.bucket, key });
      throw error;
    }
    if (result.previous) await this.deleteObjectQuietly(result.previous);
    return result.publicUrl;
  }

  private async deleteObjectQuietly(file: Omit<StoredObjectRef, 'id'>): Promise<void> {
    if (file.provider !== 'R2' || !this.storage.isConfigured()) {
      this.logger.warn(`객체를 지울 저장소가 없어 건너뜀: ${file.provider} ${file.bucket}/${file.key}`);
      return;
    }
    try {
      await this.storage.delete(file.key, file.bucket);
    } catch (error) {
      this.logger.warn(`객체 삭제 실패 ${file.bucket}/${file.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
