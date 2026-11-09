import sharp from 'sharp';
import { sampleImage } from '../testing/images.js';
import { AVATAR_INVALID_MESSAGE, AVATAR_MAX_BYTES, detectImageType, toAvatarWebp } from './avatar-image.js';

function ftyp(brand: string): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, 'latin1'), Buffer.alloc(8)]);
}

describe('detectImageType', () => {
  it('시그니처로 jpeg/png/webp/heic 를 가린다', async () => {
    expect(detectImageType(await sampleImage('jpeg'))).toBe('image/jpeg');
    expect(detectImageType(await sampleImage('png'))).toBe('image/png');
    expect(detectImageType(await sampleImage('webp'))).toBe('image/webp');
    expect(detectImageType(ftyp('heic'))).toBe('image/heic');
    expect(detectImageType(ftyp('mif1'))).toBe('image/heic');
  });

  it('그 외(gif, svg, avif, 빈 값, 짧은 값) 는 null', () => {
    expect(detectImageType(Buffer.from('GIF89a......', 'latin1'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(ftyp('avif'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(Buffer.from('RIFF....WAVE', 'latin1'))).toBeNull();
  });
});

describe('toAvatarWebp', () => {
  it('512×512 cover webp 로 바꾼다', async () => {
    const out = await toAvatarWebp(await sampleImage('png', 1024, 300));
    expect(out).toMatchObject({ mimeType: 'image/webp', width: 512, height: 512 });
    const meta = await sharp(out.buffer).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 512, height: 512 });
    expect(meta.exif).toBeUndefined();
  });

  it('형식 밖, 빈 파일, 10MB 초과는 400 VALIDATION_FAILED (details 에 file)', async () => {
    for (const input of [Buffer.from('not an image'), Buffer.alloc(0), Buffer.concat([await sampleImage('jpeg'), Buffer.alloc(AVATAR_MAX_BYTES)])]) {
      await expect(toAvatarWebp(input)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message: AVATAR_INVALID_MESSAGE,
        details: [{ field: 'file', message: AVATAR_INVALID_MESSAGE }],
      });
    }
  });

  it('시그니처는 맞지만 디코딩이 안 되면 400 (깨진 파일)', async () => {
    const broken = (await sampleImage('png')).subarray(0, 40);
    await expect(toAvatarWebp(broken)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: '사진을 읽을 수 없어요. 다른 사진으로 시도해 주세요' });
  });
});
