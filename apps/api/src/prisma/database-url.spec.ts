import { withDriverDefaults } from './database-url.js';

describe('withDriverDefaults', () => {
  it('allowPublicKeyRetrieval 이 없으면 true 로 붙인다', () => {
    const out = new URL(withDriverDefaults('mysql://u:p@db.internal:3306/railway'));
    expect(out.searchParams.get('allowPublicKeyRetrieval')).toBe('true');
    expect(out.username).toBe('u');
    expect(out.password).toBe('p');
    expect(out.host).toBe('db.internal:3306');
    expect(out.pathname).toBe('/railway');
  });

  it('기존 쿼리는 유지한다', () => {
    const out = new URL(withDriverDefaults('mysql://u:p@h:3306/d?connectionLimit=5'));
    expect(out.searchParams.get('connectionLimit')).toBe('5');
    expect(out.searchParams.get('allowPublicKeyRetrieval')).toBe('true');
  });

  it('명시한 값은 덮어쓰지 않는다', () => {
    const out = new URL(withDriverDefaults('mysql://u:p@h/d?allowPublicKeyRetrieval=false'));
    expect(out.searchParams.get('allowPublicKeyRetrieval')).toBe('false');
  });

  it('비밀번호의 특수문자 인코딩을 보존한다', () => {
    const out = withDriverDefaults('mysql://u:a%40b%2Fc@h/d');
    expect(new URL(out).password).toBe('a%40b%2Fc');
  });
});
