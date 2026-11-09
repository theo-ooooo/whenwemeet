import { ApiException } from '../src/common/errors.js';

/** e2e 용 저장소. StorageService 와 같은 모양으로 객체를 메모리에 둔다 */
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

  publicUrl(key: string): string {
    return `https://img.e2e.example/${key}`;
  }

  keyOf(url: string): string {
    return url.replace('https://img.e2e.example/', '');
  }
}
