import { ConfigService } from '@nestjs/config';
import { FileUrlBuilder, joinPublicUrl } from './file-url.builder.js';

function builderWith(env: Record<string, string>): FileUrlBuilder {
  return new FileUrlBuilder(new ConfigService(env));
}

describe('joinPublicUrl', () => {
  it('base 끝 슬래시 개수와 상관없이 슬래시 하나로 잇는다', () => {
    for (const base of [
      'https://images.whenwemeet.day',
      'https://images.whenwemeet.day/',
      'https://images.whenwemeet.day///',
    ]) {
      expect(joinPublicUrl(base, 'avatars/12/01JCK.webp')).toBe(
        'https://images.whenwemeet.day/avatars/12/01JCK.webp',
      );
    }
  });

  it('base 에 경로가 있어도 유지하고, 키 앞의 슬래시는 버린다', () => {
    expect(joinPublicUrl('https://cdn.example/img/', '/avatars/1/a.webp')).toBe(
      'https://cdn.example/img/avatars/1/a.webp',
    );
  });

  it('키는 경로 조각마다 인코딩한다. 구분자 / 는 남기고 조각 안의 공백, #, ?, %, 한글은 인코딩', () => {
    expect(
      joinPublicUrl('https://x.example', 'events/7/내 사진 #1?.webp'),
    ).toBe(
      'https://x.example/events/7/%EB%82%B4%20%EC%82%AC%EC%A7%84%20%231%3F.webp',
    );
    expect(joinPublicUrl('https://x.example', 'a/100%.webp')).toBe(
      'https://x.example/a/100%25.webp',
    );
  });

  it('지금 쓰는 키 모양(avatars/<id>/<ulid>.webp) 은 그대로', () => {
    expect(
      joinPublicUrl(
        'https://x.example',
        'avatars/3/01JCKZ8Q6V3M5W1ABCDEFGHJKM.webp',
      ),
    ).toBe('https://x.example/avatars/3/01JCKZ8Q6V3M5W1ABCDEFGHJKM.webp');
  });
});

describe('FileUrlBuilder', () => {
  it('R2 파일은 R2_PUBLIC_BASE_URL + key. 도메인을 바꾸면 같은 행의 URL 도 바뀐다', () => {
    const file = { provider: 'R2' as const, key: 'avatars/1/a.webp' };
    expect(
      builderWith({
        R2_PUBLIC_BASE_URL: 'https://images.whenwemeet.day/',
      }).publicUrl(file),
    ).toBe('https://images.whenwemeet.day/avatars/1/a.webp');
    expect(
      builderWith({
        R2_PUBLIC_BASE_URL: 'https://img.new-domain.example',
      }).publicUrl(file),
    ).toBe('https://img.new-domain.example/avatars/1/a.webp');
  });

  it('공개 주소가 없는 저장소(미설정 R2, LOCAL) 의 파일은 null. 업로드 직후처럼 반드시 필요하면 503', () => {
    const unset = builderWith({ R2_PUBLIC_BASE_URL: '  ' });
    expect(unset.publicUrl({ provider: 'R2', key: 'k' })).toBeNull();
    expect(() => unset.requirePublicUrl({ provider: 'R2', key: 'k' })).toThrow(
      expect.objectContaining({ code: 'STORAGE_NOT_CONFIGURED' }),
    );

    const r2 = builderWith({ R2_PUBLIC_BASE_URL: 'https://x.example' });
    expect(r2.publicUrl({ provider: 'LOCAL', key: 'k' })).toBeNull();
    expect(r2.requirePublicUrl({ provider: 'R2', key: 'k' })).toBe(
      'https://x.example/k',
    );
  });

  it('publicUrlOrNull: 관계가 없으면(null) null', () => {
    const r2 = builderWith({ R2_PUBLIC_BASE_URL: 'https://x.example' });
    expect(r2.publicUrlOrNull(null)).toBeNull();
    expect(
      r2.publicUrlOrNull({ provider: 'R2', key: 'avatars/1/a.webp' }),
    ).toBe('https://x.example/avatars/1/a.webp');
  });
});
