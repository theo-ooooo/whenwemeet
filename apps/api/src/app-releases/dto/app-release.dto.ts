import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Trim } from '../../common/validation.js';
import { VERSION_PATTERN } from '../app-version.js';

const VERSION_MESSAGE = (field: string) =>
  `${field} 는 1.4.0 처럼 숫자와 점(최대 3마디)이어야 해요`;
const STORE_URL_MESSAGE =
  'storeUrl 은 https 로 시작하는 500자 이하 주소여야 해요';

/**
 * (#539) PUT /admin/app-releases/:platform (D-292). 생략은 그대로, null 은 지움(최신, 최소 버전이 null 이면 그 안내를 하지 않고,
 * 스토어 주소가 null 이면 기본 스토어 주소)
 */
export class UpdateAppReleaseDto {
  @ValidateIf(
    (_: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @Trim()
  @IsString({ message: VERSION_MESSAGE('latestVersion') })
  @Matches(VERSION_PATTERN, { message: VERSION_MESSAGE('latestVersion') })
  latestVersion?: string | null;

  @ValidateIf(
    (_: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @Trim()
  @IsString({ message: VERSION_MESSAGE('minVersion') })
  @Matches(VERSION_PATTERN, { message: VERSION_MESSAGE('minVersion') })
  minVersion?: string | null;

  @ValidateIf(
    (_: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @Trim()
  @IsString({ message: STORE_URL_MESSAGE })
  @MaxLength(500, { message: STORE_URL_MESSAGE })
  @Matches(/^https:\/\/[^\s]+$/, { message: STORE_URL_MESSAGE })
  storeUrl?: string | null;
}
