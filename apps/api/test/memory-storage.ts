import { ApiException } from '../src/common/errors.js';

/** e2e 의 공개 주소. 실제 서비스처럼 R2_PUBLIC_BASE_URL 에만 있고 DB 에는 저장되지 않는다 (D-49) */
export const E2E_PUBLIC_BASE_URL = 'https://img.e2e.example';

/** e2e 용 저장소. StorageService 와 같은 모양으로 객체를 메모리에 둔다. 공개 URL 은 FileUrlBuilder 몫 */
export class MemoryStorage {
  readonly provider = 'R2' as const;
  readonly bucket = 'e2e-bucket';
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  failDelete = false;

  isConfigured(): boolean {
    return true;
  }

  assertConfigured(): void {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async delete(key: string, _bucket?: string): Promise<void> {
    if (this.failDelete) throw new ApiException('INTERNAL');
    this.objects.delete(key);
  }

  keyOf(url: string): string {
    return url.replace(`${E2E_PUBLIC_BASE_URL}/`, '');
  }
}
