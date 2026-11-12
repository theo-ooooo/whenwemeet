import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';
import { Trim } from '../../common/validation.js';

/** (#276) 목록 이름 1~30자, 항목 글 1~100자 (앞뒤 공백을 자른 길이, api.md 1장 "문자열 공백") */
export const TODO_LIST_NAME_MAX = 30;
export const TODO_ITEM_TEXT_MAX = 100;

const NAME_MESSAGE = `목록 이름은 1~${TODO_LIST_NAME_MAX}자여야 해요`;
const TEXT_MESSAGE = `할 일은 1~${TODO_ITEM_TEXT_MAX}자여야 해요`;

/** 목록 만들기, 이름 바꾸기 (같은 모양) */
export class TodoListInputDto {
  @Trim()
  @IsString({ message: NAME_MESSAGE })
  @Length(1, TODO_LIST_NAME_MAX, { message: NAME_MESSAGE })
  name!: string;
}

/** 항목 추가. done 은 삭제 되돌리기에서 완료 상태를 같이 되살릴 때만 (D-204) */
export class TodoItemCreateDto {
  @Trim()
  @IsString({ message: TEXT_MESSAGE })
  @Length(1, TODO_ITEM_TEXT_MAX, { message: TEXT_MESSAGE })
  text!: string;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'done 은 true/false 여야 해요' })
  done?: boolean;
}

/** 항목 고치기. 둘 다 생략하면 그대로 돌려준다. null 은 생략과 달리 거부 (열이 NOT NULL) */
export class TodoItemPatchDto {
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @Trim()
  @IsString({ message: TEXT_MESSAGE })
  @Length(1, TODO_ITEM_TEXT_MAX, { message: TEXT_MESSAGE })
  text?: string;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'done 은 true/false 여야 해요' })
  done?: boolean;
}
