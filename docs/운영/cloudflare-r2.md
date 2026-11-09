# Cloudflare R2 설정 (프로필 사진 저장소)

키 값은 `apps/api/.env` 에만 넣고 문서에 적지 않는다.

## 1. 버킷
[dash.cloudflare.com](https://dash.cloudflare.com) > R2 Object Storage > Create bucket
- 이름: `whenwemeet` (운영), `whenwemeet-dev` (로컬/개발)
- 위치: Asia-Pacific (APAC)

## 2. 공개 접근
버킷 > Settings > Public access
- 운영: Custom Domains 에 `img.whenwemeet.day` 연결 (Cloudflare DNS 에 도메인이 있어야 함). `R2_PUBLIC_BASE_URL=https://img.whenwemeet.day`
- 개발: R2.dev subdomain 을 Allow 로 켜고 그 주소를 `R2_PUBLIC_BASE_URL` 로 (`https://pub-xxxx.r2.dev`). 운영에선 r2.dev 를 끈다 (속도 제한, 캐시 없음)

## 3. API 토큰
R2 > Manage R2 API Tokens > Create API token
- 권한: Object Read & Write
- 버킷 지정: 위 버킷만
- 발급되는 Access Key ID / Secret Access Key → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- 계정 ID(대시보드 우측 또는 R2 개요) → `R2_ACCOUNT_ID`. S3 엔드포인트는 `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`

## 4. .env
```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=whenwemeet-dev
R2_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev
```

## 5. 수명 주기 (선택)
버킷 > Settings > Object lifecycle rules: `tmp/` 접두사 1일 후 삭제 (업로드 중 실패한 임시 파일용)

## 비용
무료 구간: 저장 10GB, Class A(쓰기) 월 100만, Class B(읽기) 월 1,000만, egress 무료. 프로필 사진 512px webp 는 장당 약 30KB.
