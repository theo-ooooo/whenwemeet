import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors.js';
import type { StorageProvider } from '../generated/prisma/enums.js';

/** 공개 URL 을 만드는 데 필요한 File 의 부분. 도메인은 DB 에 두지 않는다 (결정기록 D-56) */
export interface FileLocation {
  provider: StorageProvider;
  key: string;
}

/** URL 을 만들려고 File 에서 읽는 컬럼. Repository 의 select 에 그대로 쓴다 */
export const FILE_LOCATION_SELECT = { provider: true, key: true } as const;

/** 저장소별 공개 주소 환경 변수. 없는 저장소(LOCAL) 는 공개 URL 이 없다 */
const PUBLIC_BASE_URL_ENV: Record<StorageProvider, string | null> = {
  R2: 'R2_PUBLIC_BASE_URL',
  LOCAL: null,
};

/** base 끝의 `/` 를 정리하고, 키는 경로 조각(`/` 사이) 마다 인코딩해 붙인다 */
export function joinPublicUrl(baseUrl: string, key: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const path = key
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}/${path}`;
}

/**
 * File(provider, key) → 공개 URL. 응답의 `profileImageUrl` 등은 모두 여기서 만든다 (결정기록 D-56).
 * 도메인이 바뀌면 환경 변수(`R2_PUBLIC_BASE_URL`) 만 바꾸면 기존 파일 URL 도 함께 바뀐다
 */
@Injectable()
export class FileUrlBuilder {
  private readonly baseUrls: Map<StorageProvider, string>;

  constructor(config: ConfigService) {
    this.baseUrls = new Map();
    for (const [provider, envKey] of Object.entries(PUBLIC_BASE_URL_ENV) as [
      StorageProvider,
      string | null,
    ][]) {
      const value = envKey ? config.get<string>(envKey)?.trim() : '';
      if (value) this.baseUrls.set(provider, value);
    }
  }

  /** 공개 주소가 설정되지 않은 저장소의 파일이면 null (응답에서는 기본 아바타로 보인다) */
  publicUrl(file: FileLocation): string | null {
    const base = this.baseUrls.get(file.provider);
    return base ? joinPublicUrl(base, file.key) : null;
  }

  /** 방금 올린 파일처럼 URL 이 반드시 있어야 하는 곳. 없으면 503 STORAGE_NOT_CONFIGURED */
  requirePublicUrl(file: FileLocation): string {
    const url = this.publicUrl(file);
    if (url === null) throw new ApiException('STORAGE_NOT_CONFIGURED');
    return url;
  }

  /** nullable 관계(User.avatar 등) 용 */
  publicUrlOrNull(file: FileLocation | null): string | null {
    return file ? this.publicUrl(file) : null;
  }
}
