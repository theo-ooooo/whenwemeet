import sharp from 'sharp';
import { ApiException } from '../common/errors.js';

/** 업로드 한도 (api.md `POST /me/avatar`) */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
/** 저장 크기. 정사각 cover 로 잘라 webp 로 */
export const AVATAR_SIZE = 512;
const AVATAR_WEBP_QUALITY = 82;

export type AvatarSourceType =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

/** 형식/크기 오류 문구 (화면흐름 10 사진 변경) */
export const AVATAR_INVALID_MESSAGE = 'jpg, png, webp 10MB 까지 올릴 수 있어요';

/** HEIF 계열 ftyp 브랜드. iPhone 사진은 heic/heix, 일반 HEIF 는 mif1/msf1 */
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
]);

export function avatarInvalid(
  message: string = AVATAR_INVALID_MESSAGE,
): ApiException {
  return new ApiException('VALIDATION_FAILED', message, [
    { field: 'file', message },
  ]);
}

/** 파일 앞부분 시그니처로 형식을 정한다. 클라이언트가 보낸 Content-Type 과 확장자는 믿지 않는다 */
export function detectImageType(buffer: Buffer): AvatarSourceType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 4, 8) === 'ftyp' &&
    HEIF_BRANDS.has(buffer.toString('latin1', 8, 12))
  ) {
    return 'image/heic';
  }
  return null;
}

export interface AvatarImage {
  buffer: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
}

/**
 * 검증 → EXIF 회전 반영 → 512×512 cover → webp. 메타데이터(EXIF, 위치) 는 버린다.
 * 시그니처는 맞아도 디코딩이 안 되면(깨진 파일, 지원 안 되는 HEIC 코덱) 400
 */
export async function toAvatarWebp(buffer: Buffer): Promise<AvatarImage> {
  if (
    buffer.length === 0 ||
    buffer.length > AVATAR_MAX_BYTES ||
    !detectImageType(buffer)
  )
    throw avatarInvalid();
  try {
    const { data, info } = await sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: AVATAR_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      mimeType: 'image/webp',
      width: info.width,
      height: info.height,
    };
  } catch {
    throw avatarInvalid('사진을 읽을 수 없어요. 다른 사진으로 시도해 주세요');
  }
}
