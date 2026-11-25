import { IsBoolean, IsIn, IsString, Length, ValidateIf } from 'class-validator';
import { Trim } from '../../common/validation.js';

/** (#515) 공지 제목 1~100자, 본문 1~20000자 (앞뒤 공백을 자른 길이, api.md 1장 "문자열 공백") */
export const NOTICE_TITLE_MAX = 100;
export const NOTICE_BODY_MAX = 20_000;
/** Prisma enum NoticeKind 와 같은 값 (D-285) */
export const NOTICE_KINDS = ['notice', 'update', 'maintenance'] as const;
export type NoticeKindValue = (typeof NOTICE_KINDS)[number];

const TITLE_MESSAGE = `제목은 1~${NOTICE_TITLE_MAX}자여야 해요`;
const BODY_MESSAGE = `본문은 1~${NOTICE_BODY_MAX}자여야 해요`;
const KIND_MESSAGE = 'kind 는 notice, update, maintenance 중 하나여야 해요';
const BOOL_MESSAGE = (field: string) => `${field} 는 true/false 여야 해요`;

/** POST /admin/notices. published 가 true 면 바로 게시(publishedAt = 지금), 아니면 초안 */
export class CreateNoticeDto {
  @Trim()
  @IsString({ message: TITLE_MESSAGE })
  @Length(1, NOTICE_TITLE_MAX, { message: TITLE_MESSAGE })
  title!: string;

  @Trim()
  @IsString({ message: BODY_MESSAGE })
  @Length(1, NOTICE_BODY_MAX, { message: BODY_MESSAGE })
  body!: string;

  @IsIn(NOTICE_KINDS, { message: KIND_MESSAGE })
  kind!: NoticeKindValue;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: BOOL_MESSAGE('pinned') })
  pinned?: boolean;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: BOOL_MESSAGE('published') })
  published?: boolean;

  /** (#528) 게시와 같이 전체 푸시. published 가 true 일 때만 (D-287) */
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: BOOL_MESSAGE('push') })
  push?: boolean;
}

/**
 * PATCH /admin/notices/:id. 생략은 그대로. published: true 는 초안이면 지금 게시(이미 게시면 처음 게시 시각 유지),
 * false 는 게시 취소(초안으로)
 */
export class UpdateNoticeDto {
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @Trim()
  @IsString({ message: TITLE_MESSAGE })
  @Length(1, NOTICE_TITLE_MAX, { message: TITLE_MESSAGE })
  title?: string;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @Trim()
  @IsString({ message: BODY_MESSAGE })
  @Length(1, NOTICE_BODY_MAX, { message: BODY_MESSAGE })
  body?: string;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsIn(NOTICE_KINDS, { message: KIND_MESSAGE })
  kind?: NoticeKindValue;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: BOOL_MESSAGE('pinned') })
  pinned?: boolean;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: BOOL_MESSAGE('published') })
  published?: boolean;

  /** (#528) 전체 푸시. 고친 결과가 게시 상태여야 하고 한 공지는 한 번만 (이미 보냈으면 409, D-287) */
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: BOOL_MESSAGE('push') })
  push?: boolean;
}
