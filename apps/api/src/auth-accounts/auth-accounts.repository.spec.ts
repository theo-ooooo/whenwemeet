import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ABSORB_CHECKED_GROUP_RELATIONS,
  ABSORB_CHECKED_USER_RELATIONS,
  ABSORB_CLEANED_USER_RELATIONS,
  ABSORB_IGNORED_GROUP_RELATIONS,
} from './auth-accounts.repository.js';

/** schema.prisma 에서 모델 하나의 관계 필드 이름 (다른 모델을 가리키는 필드) */
function relationFields(model: string): string[] {
  const schema = readFileSync(
    fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
    'utf8',
  );
  const models = new Set(
    [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]),
  );
  const body =
    schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'))?.[1] ??
    '';
  return body
    .split('\n')
    .map((line) => line.trim().match(/^(\w+)\s+(\w+)(\[\]|\?)?/))
    .filter((m): m is RegExpMatchArray => m !== null && models.has(m[2]))
    .map((m) => m[1]);
}

describe('(#198) 빈 계정 판정이 스키마의 모든 관계를 본다 (D-257)', () => {
  it('User 의 관계는 모두 판정(데이터) 또는 정리(부속물) 표에 있다. 새 관계를 추가하면 여기서 깨진다', () => {
    const classified = new Set<string>([
      ...ABSORB_CHECKED_USER_RELATIONS,
      ...ABSORB_CLEANED_USER_RELATIONS,
    ]);
    const fields = relationFields('User');
    expect(fields.length).toBeGreaterThan(20);
    expect(fields.filter((field) => !classified.has(field))).toEqual([]);
    expect([...classified].filter((field) => !fields.includes(field))).toEqual(
      [],
    );
  });

  it('Group 의 관계는 모두 개인 팀 판정 표에 있다', () => {
    const classified = new Set<string>([
      ...ABSORB_CHECKED_GROUP_RELATIONS,
      ...ABSORB_IGNORED_GROUP_RELATIONS,
    ]);
    const fields = relationFields('Group');
    expect(fields.filter((field) => !classified.has(field))).toEqual([]);
    expect([...classified].filter((field) => !fields.includes(field))).toEqual(
      [],
    );
  });
});
